import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import * as esbuild from "esbuild";

const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.use(express.json());

// Set ALLOWED_BASE_PATHS from environment variable or default fallback paths
const ALLOWED_BASE_PATHS = (process.env.ALLOWED_BASE_PATHS || "")
  .split(",")
  .map(p => p.trim())
  .filter(Boolean);

if (ALLOWED_BASE_PATHS.length === 0) {
  // Fallbacks: allow the user to browse current workspace directory and its parent for demo
  ALLOWED_BASE_PATHS.push(process.cwd());
  const parentDir = path.dirname(process.cwd());
  if (parentDir && parentDir !== process.cwd()) {
    ALLOWED_BASE_PATHS.push(parentDir);
  }
}

// Pre-resolve absolute paths for exact prefix matching
const ABSOLUTE_ALLOWED_BASE_PATHS = ALLOWED_BASE_PATHS.map(p => path.resolve(p));

// Make CURRENT_WORKSPACE_ROOT dynamic/mutable
let CURRENT_WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

interface FileBackup {
  path: string;
  previousContent: string | null;
}

const executionBackups: Record<string, FileBackup[]> = {};

/**
 * Returns a unique file path for the fallback vector store, isolated per workspace path using MD5 hash.
 */
function getFallbackStorePath(workspaceRoot: string): string {
  const hash = crypto.createHash("md5").update(workspaceRoot).digest("hex");
  return path.join(process.cwd(), `chroma_fallback_${hash}.json`);
}

/**
 * Validates whether the requested path lies strictly inside the ALLOWED_BASE_PATHS.
 */
function isPathInAllowedBases(targetPath: string): { safe: boolean; resolvedPath: string; error: string } {
  try {
    const resolvedPath = path.resolve(targetPath);
    
    for (const base of ABSOLUTE_ALLOWED_BASE_PATHS) {
      try {
        const absBase = fs.realpathSync(base);
        const basePrefix = absBase.endsWith(path.sep) ? absBase : absBase + path.sep;
        
        let absTarget: string;
        try {
          absTarget = fs.realpathSync(resolvedPath);
        } catch (e) {
          absTarget = resolvedPath;
        }

        if (absTarget === absBase || absTarget.startsWith(basePrefix)) {
          return { safe: true, resolvedPath: absTarget, error: "" };
        }
      } catch (e) {
        // Fallback to simple startsWith comparison if realpath fails
        const absBase = path.resolve(base);
        const basePrefix = absBase.endsWith(path.sep) ? absBase : absBase + path.sep;
        if (resolvedPath === absBase || resolvedPath.startsWith(basePrefix)) {
          return { safe: true, resolvedPath, error: "" };
        }
      }
    }
    return {
      safe: false,
      resolvedPath: "",
      error: `Akses ditolak: Folder '${targetPath}' di luar daftar folder dasar yang diizinkan (ALLOWED_BASE_PATHS).`
    };
  } catch (err: any) {
    return { safe: false, resolvedPath: "", error: `Gagal memvalidasi folder dasar: ${err.message}` };
  }
}

/**
 * Node/TypeScript equivalent of resolve_and_sandbox_path from manifest.py.
 * Ensures that any targeted path lies strictly within the allowed workspace root.
 */
function resolveAndSandboxPath(targetPath: string, root: string): { safe: boolean; resolvedPath: string; error: string } {
  try {
    // Resolve absolute root path
    let absRoot: string;
    try {
      absRoot = fs.realpathSync(root);
    } catch (e) {
      absRoot = path.resolve(root);
    }
    
    // Clean leading slashes/separators to prevent absolute paths from bypassing join
    const cleanRelative = targetPath.replace(/^[\\\/]+/, "");
    const joined = path.join(absRoot, cleanRelative);
    
    // Since the target might not exist yet (e.g. write_file), we can't always call realpathSync on it directly.
    // Instead, we resolve its parent path or clean path representation.
    const resolvedPath = path.resolve(joined);
    
    // Check if it starts with the root prefix
    const rootPrefix = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
    
    if (resolvedPath === absRoot) {
      return { safe: true, resolvedPath, error: "" };
    }
    
    if (!resolvedPath.startsWith(rootPrefix)) {
      return {
        safe: false,
        resolvedPath: "",
        error: `Deteksi Path Traversal: Path '${targetPath}' merujuk ke luar workspace root.`
      };
    }
    
    return { safe: true, resolvedPath, error: "" };
  } catch (err: any) {
    return { safe: false, resolvedPath: "", error: `Gagal memetakan path: ${err.message}` };
  }
}

/**
 * Checks for syntax errors in proposed file contents (JSON, JS, TS, JSX, TSX, HTML, Python).
 */
function checkSyntax(filePath: string, content: string): { valid: boolean; error?: string; line?: number; column?: number } {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === ".json") {
    try {
      JSON.parse(content);
      return { valid: true };
    } catch (err: any) {
      let line = 1;
      let column = 1;
      const match = err.message.match(/at position (\d+)/);
      if (match) {
        const pos = parseInt(match[1], 10);
        const lines = content.slice(0, pos).split("\n");
        line = lines.length;
        column = lines[lines.length - 1].length + 1;
      }
      return { 
        valid: false, 
        error: `Format JSON tidak valid: ${err.message}`,
        line,
        column
      };
    }
  }
  
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    try {
      let loader: "js" | "jsx" | "ts" | "tsx" = "js";
      if (ext === ".jsx") loader = "jsx";
      else if (ext === ".ts") loader = "ts";
      else if (ext === ".tsx") loader = "tsx";
      
      esbuild.transformSync(content, {
        loader: loader,
        format: "esm",
        minify: false,
        sourcemap: false
      });
      return { valid: true };
    } catch (err: any) {
      if (err.errors && err.errors.length > 0) {
        const firstErr = err.errors[0];
        return {
          valid: false,
          error: `Kesalahan Sintaksis JS/TS: ${firstErr.text}`,
          line: firstErr.location?.line || 1,
          column: firstErr.location?.column || 1
        };
      }
      return { valid: false, error: err.message || "Gagal memproses kode JavaScript/TypeScript." };
    }
  }

  if (ext === ".html") {
    const unclosedTags: string[] = [];
    const selfClosing = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
    const tagRegex = /<(\/?[a-zA-Z0-9:-]+)(?:\s+[^>]*)?>/g;
    let match;
    let line = 1;
    let lastIndex = 0;
    
    while ((match = tagRegex.exec(content)) !== null) {
      const tagWithSlash = match[1];
      const index = match.index;
      
      const textBefore = content.substring(lastIndex, index);
      const lines = textBefore.split("\n");
      line += lines.length - 1;
      lastIndex = index;
      
      if (tagWithSlash.startsWith("/")) {
        const closeTag = tagWithSlash.substring(1).toLowerCase();
        if (unclosedTags.length > 0) {
          const lastOpen = unclosedTags[unclosedTags.length - 1];
          if (lastOpen === closeTag) {
            unclosedTags.pop();
          } else {
            return {
              valid: false,
              error: `Tag Mismatch: Menemukan tag penutup </${closeTag}> tetapi tag pembuka terakhir yang belum ditutup adalah <${lastOpen}>.`,
              line
            };
          }
        }
      } else {
        const openTag = tagWithSlash.toLowerCase();
        if (!selfClosing.has(openTag)) {
          unclosedTags.push(openTag);
        }
      }
    }
    
    if (unclosedTags.length > 0) {
      return {
        valid: false,
        error: `Tag Belum Ditutup: Tag <${unclosedTags[unclosedTags.length - 1]}> tidak memiliki tag penutup </${unclosedTags[unclosedTags.length - 1]}>.`,
        line
      };
    }
    
    return { valid: true };
  }

  if (ext === ".py") {
    const stack: { char: string; line: number }[] = [];
    const openChars = ["(", "[", "{"];
    const closeChars = [")", "]", "}"];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      let insideSingleQuote = false;
      let insideDoubleQuote = false;
      
      for (let j = 0; j < lineText.length; j++) {
        const char = lineText[j];
        if (char === "'" && lineText[j-1] !== "\\") {
          insideSingleQuote = !insideSingleQuote;
          continue;
        }
        if (char === '"' && lineText[j-1] !== "\\") {
          insideDoubleQuote = !insideDoubleQuote;
          continue;
        }
        if (insideSingleQuote || insideDoubleQuote) continue;
        
        if (openChars.includes(char)) {
          stack.push({ char, line: i + 1 });
        } else if (closeChars.includes(char)) {
          if (stack.length === 0) {
            return {
              valid: false,
              error: `Syntax Error: Menemukan kurung tutup '${char}' tanpa pasangan kurung buka yang cocok.`,
              line: i + 1,
              column: j + 1
            };
          }
          const last = stack.pop()!;
          if (last.char !== pairs[char]) {
            return {
              valid: false,
              error: `Syntax Error: Kurung '${char}' tidak cocok dengan kurung '${last.char}' di baris ${last.line}.`,
              line: i + 1,
              column: j + 1
            };
          }
        }
      }
    }
    
    if (stack.length > 0) {
      const last = stack[stack.length - 1];
      return {
        valid: false,
        error: `Syntax Error: Kurung '${last.char}' di baris ${last.line} tidak ditutup.`,
        line: last.line
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a manifest array of actions.
 */
function validateManifest(actions: any[], root: string) {
  const whitelist = new Set(["read_file", "scan_directory", "write_file"]);
  const results = [];
  let allValid = true;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const res = {
      index: i,
      action,
      valid: false,
      error: "",
      resolved_path: ""
    };

    if (!action || typeof action !== "object") {
      res.error = "Action entry must be an object.";
      results.push(res);
      allValid = false;
      continue;
    }

    const { type, path: actionPath, content } = action;

    if (!type) {
      res.error = "Missing required 'type' field in action.";
      results.push(res);
      allValid = false;
      continue;
    }

    if (!whitelist.has(type)) {
      res.error = `Action type '${type}' is not supported. Must be one of read_file, scan_directory, write_file.`;
      results.push(res);
      allValid = false;
      continue;
    }

    if (actionPath === undefined || actionPath === null) {
      res.error = "Missing required 'path' field in action.";
      results.push(res);
      allValid = false;
      continue;
    }

    if (typeof actionPath !== "string") {
      res.error = "Field 'path' must be a string.";
      results.push(res);
      allValid = false;
      continue;
    }

    // Sandboxing check
    const sandbox = resolveAndSandboxPath(actionPath, root);
    if (!sandbox.safe) {
      res.error = sandbox.error;
      results.push(res);
      allValid = false;
      continue;
    }

    if (type === "write_file") {
      if (content === undefined || content === null) {
        res.error = "Missing required 'content' field for write_file action.";
        results.push(res);
        allValid = false;
        continue;
      }
      if (typeof content !== "string") {
        res.error = "Field 'content' must be a string.";
        results.push(res);
        allValid = false;
        continue;
      }

      // Pre-flight code syntax validation
      const syntaxResult = checkSyntax(actionPath, content);
      if (!syntaxResult.valid) {
        res.error = `Gagal Pre-flight Sintaksis: ${syntaxResult.error}${
          syntaxResult.line ? ` (Baris ${syntaxResult.line}${syntaxResult.column ? `, Kolom ${syntaxResult.column}` : ""})` : ""
        }`;
        (res as any).syntax_error = {
          message: syntaxResult.error,
          line: syntaxResult.line,
          column: syntaxResult.column
        };
        results.push(res);
        allValid = false;
        continue;
      }
    }

    res.valid = true;
    res.resolved_path = sandbox.resolvedPath;
    results.push(res);
  }

  return { valid: allValid, results };
}

/**
 * Node/TypeScript equivalent of indexing/updating a file in the fallback vector memory store.
 * Synchronizes the ledger database located in './chroma_fallback.json' or hashed workspace equivalent.
 * This keeps the Node.js dev server and FastAPI python backend completely in sync!
 */
function indexOrUpdateFileInStore(filePath: string, content: string) {
  try {
    // Make path relative to CURRENT_WORKSPACE_ROOT for uniform identification
    const relativePath = path.relative(CURRENT_WORKSPACE_ROOT, filePath).replace(/\\/g, "/");
    const hash = crypto.createHash("md5").update(content).digest("hex");
    const fallbackPath = getFallbackStorePath(CURRENT_WORKSPACE_ROOT);
    
    let db = { files: {} as any, chunks: [] as any[] };
    if (fs.existsSync(fallbackPath)) {
      try {
        db = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
      } catch (e) {
        // use default if corrupt
      }
    }
    
    if (!db.files) db.files = {};
    if (!Array.isArray(db.chunks)) db.chunks = [];
    
    // Check if MD5 hash matches to avoid redundant embeddings
    if (db.files[relativePath] && db.files[relativePath].hash === hash) {
      return; // Content hasn't changed, skip indexing
    }
    
    // Delete existing chunks for this file
    db.chunks = db.chunks.filter((c: any) => c.filename !== relativePath);
    
    // Save file ledger info
    db.files[relativePath] = {
      hash: hash,
      timestamp: Date.now() / 1000
    };
    
    // Perform block-based paragraph split chunking
    const paragraphs = content.split("\n\n");
    paragraphs.forEach((p, idx) => {
      const pStrip = p.trim();
      if (!pStrip) return;
      
      db.chunks.push({
        id: `${relativePath}#chunk_${idx}`,
        filename: relativePath,
        content: pStrip,
        vector: Array.from({ length: 128 }, () => Math.random() * 2 - 1), // mock vector
        metadata: {
          filename: relativePath,
          entity_name: `block_${idx}`,
          entity_type: "text_block"
        }
      });
    });
    
    fs.writeFileSync(fallbackPath, JSON.stringify(db, null, 2), "utf-8");
  } catch (err: any) {
    console.error("Node vector memory indexing warning:", err.message);
  }
}

// REST endpoints:
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", workspace_root: CURRENT_WORKSPACE_ROOT });
});

app.get("/api/file/content", (req, res) => {
  const targetPath = req.query.path as string;
  if (!targetPath) {
    return res.status(400).json({ status: "failed", error: "Missing required 'path' query parameter." });
  }
  const sandbox = resolveAndSandboxPath(targetPath, CURRENT_WORKSPACE_ROOT);
  if (!sandbox.safe) {
    return res.status(403).json({ status: "failed", error: sandbox.error });
  }
  if (!fs.existsSync(sandbox.resolvedPath)) {
    return res.json({ status: "success", exists: false, content: "" });
  }
  try {
    const content = fs.readFileSync(sandbox.resolvedPath, "utf-8");
    return res.json({ status: "success", exists: true, content });
  } catch (err: any) {
    return res.status(500).json({ status: "failed", error: err.message });
  }
});

app.get("/api/memory/status", (req, res) => {
  try {
    const fallbackPath = getFallbackStorePath(CURRENT_WORKSPACE_ROOT);
    let statusList: any[] = [];
    
    if (fs.existsSync(fallbackPath)) {
      try {
        const db = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
        if (db && db.files) {
          statusList = Object.entries(db.files).map(([filename, info]: [string, any]) => ({
            filename: filename,
            hash: info.hash,
            last_updated: info.timestamp
          }));
        }
      } catch (e) {}
    }
    
    res.json({
      status: "success",
      indexed_files: statusList,
      count: statusList.length
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

/**
 * Long-Term Memory Helper functions
 */
interface LongTermMemoryFact {
  id: string;
  category: "user" | "ai";
  content: string;
  timestamp: number;
}

function getLongTermMemoryPath(workspaceRoot: string): string {
  const hash = crypto.createHash("md5").update(workspaceRoot).digest("hex");
  return path.join(process.cwd(), `long_term_memory_${hash}.json`);
}

function readLongTermMemories(workspaceRoot: string): LongTermMemoryFact[] {
  const memoryPath = getLongTermMemoryPath(workspaceRoot);
  if (!fs.existsSync(memoryPath)) {
    const defaultMemories: LongTermMemoryFact[] = [
      {
        id: "seed-ai-1",
        category: "ai",
        content: "Saya adalah Human-Assisted AI Agent yang bekerja melalui proposal Manifest JSON.",
        timestamp: Date.now()
      },
      {
        id: "seed-ai-2",
        category: "ai",
        content: "Saya berkomunikasi dengan ramah dan sopan dalam bahasa Indonesia.",
        timestamp: Date.now()
      }
    ];
    try {
      fs.writeFileSync(memoryPath, JSON.stringify(defaultMemories, null, 2), "utf-8");
    } catch (e) {
      console.error("Gagal menulis memori default:", e);
    }
    return defaultMemories;
  }
  try {
    const content = fs.readFileSync(memoryPath, "utf-8");
    return JSON.parse(content) as LongTermMemoryFact[];
  } catch (err) {
    console.error("Gagal membaca memori jangka panjang:", err);
    return [];
  }
}

function writeLongTermMemories(workspaceRoot: string, memories: LongTermMemoryFact[]) {
  const memoryPath = getLongTermMemoryPath(workspaceRoot);
  try {
    fs.writeFileSync(memoryPath, JSON.stringify(memories, null, 2), "utf-8");
  } catch (err) {
    console.error("Gagal menulis memori jangka panjang:", err);
  }
}

/**
 * Extract facts from the chat exchange asynchronously to update long-term memory
 */
async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string,
  provider: string,
  model?: string
) {
  try {
    // If both message and response are short or don't seem factual, we could skip,
    // but running LLM extraction with a strong prompt is robust.
    const currentMemories = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
    
    const extractionPrompt = `
You are a "Memory Extraction Subsystem".
Your job is to analyze the recent conversation exchange between a User and an AI Assistant, and extract any NEW, IMPORTANT, and PERMANENT facts about:
1. The User (e.g., name, preferences, skills, habits, email, preferred languages, project goals).
2. The AI itself (e.g., how the AI should behave, facts about the AI's identity, custom names, or specialized instructions).

Do NOT extract transient information like "the user wants to read a file now" or "the user is debugging an error". Only extract permanent characteristics, facts, or long-term preferences.

Below is the exchange:
=== CONVERSATION ===
User: "${userMessage}"
Assistant: "${assistantResponse}"
====================

Compare these against the existing list of memories:
=== EXISTING MEMORIES ===
${JSON.stringify(currentMemories)}
=========================

If there are any NEW permanent facts (not already present or implied by existing memories), return them strictly as a JSON object matching this schema:
{
  "new_memories": [
    {
      "category": "user", // or "ai"
      "content": "Description of the new permanent fact"
    }
  ]
}

If no new permanent facts are found, return exactly:
{
  "new_memories": []
}

Output ONLY the JSON object. Do not include any explanation or markdown formatting outside the JSON block.
`;

    // Try to use Gemini for extraction as it is most reliable if configured, otherwise fallback to active provider
    const extractionProvider = process.env.GEMINI_API_KEY ? "gemini" : provider;
    const extractionModel = process.env.GEMINI_API_KEY ? "gemini-3.5-flash" : model;

    console.log(`[Memory] Running background extraction with provider: ${extractionProvider}, model: ${extractionModel}...`);
    const res = await callLLM(
      "Extract memories based on the instructions.",
      [],
      extractionProvider,
      extractionModel,
      extractionPrompt,
      true
    );

    let extractedJson: any = null;
    try {
      let text = res.text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```json/, "").replace(/```$/, "").trim();
      }
      extractedJson = JSON.parse(text);
    } catch (e) {
      // JSON parse fallback
    }

    if (extractedJson && Array.isArray(extractedJson.new_memories)) {
      const existing = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
      let updated = false;

      extractedJson.new_memories.forEach((mem: any) => {
        if (mem.content && (mem.category === "user" || mem.category === "ai")) {
          // Double-check to avoid duplicates
          const isDup = existing.some(
            (e: any) => e.category === mem.category && e.content.toLowerCase().replace(/[.\s]/g, "") === mem.content.toLowerCase().replace(/[.\s]/g, "")
          );
          if (!isDup) {
            existing.push({
              id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              category: mem.category,
              content: mem.content.trim(),
              timestamp: Date.now()
            });
            updated = true;
            console.log(`[Memory] Auto-extracted new fact: [${mem.category}] ${mem.content}`);
          }
        }
      });

      if (updated) {
        writeLongTermMemories(CURRENT_WORKSPACE_ROOT, existing);
      }
    }
  } catch (err: any) {
    console.error("Node automatic memory extraction warning:", err.message);
  }
}

// REST APIs for managing Long-Term Memory
app.get("/api/long-term-memories", (req, res) => {
  try {
    const memories = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
    res.json({
      status: "success",
      memories
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.post("/api/long-term-memories", (req, res) => {
  try {
    const { category, content } = req.body;
    if (!category || !content) {
      return res.status(400).json({ status: "failed", error: "Kategori dan konten memori harus diisi." });
    }
    if (category !== "user" && category !== "ai") {
      return res.status(400).json({ status: "failed", error: "Kategori harus berupa 'user' atau 'ai'." });
    }

    const memories = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
    const newFact: LongTermMemoryFact = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      category,
      content: content.trim(),
      timestamp: Date.now()
    };
    memories.push(newFact);
    writeLongTermMemories(CURRENT_WORKSPACE_ROOT, memories);

    res.json({
      status: "success",
      memory: newFact
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.put("/api/long-term-memories/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { content, category } = req.body;
    
    const memories = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
    const index = memories.findIndex(m => m.id === id);
    if (index === -1) {
      return res.status(404).json({ status: "failed", error: "Memori tidak ditemukan." });
    }

    if (content !== undefined) {
      memories[index].content = content.trim();
    }
    if (category !== undefined && (category === "user" || category === "ai")) {
      memories[index].category = category;
    }
    memories[index].timestamp = Date.now();

    writeLongTermMemories(CURRENT_WORKSPACE_ROOT, memories);
    res.json({
      status: "success",
      memory: memories[index]
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.delete("/api/long-term-memories/:id", (req, res) => {
  try {
    const { id } = req.params;
    const memories = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
    const filtered = memories.filter(m => m.id !== id);
    
    if (memories.length === filtered.length) {
      return res.status(404).json({ status: "failed", error: "Memori tidak ditemukan." });
    }

    writeLongTermMemories(CURRENT_WORKSPACE_ROOT, filtered);
    res.json({
      status: "success",
      message: "Memori berhasil dihapus."
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

// Helper function to call AI Models across different providers (Gemini, OpenRouter, Ollama)
async function callLLM(
  message: string,
  history: any[],
  provider: string,
  model?: string,
  systemPrompt?: string,
  forceJson: boolean = false
): Promise<{ text: string; actualModel?: string }> {
  const selectedProvider = provider.toLowerCase();
  let llmResponse = "";
  let actualModel = model;

  if (selectedProvider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      llmResponse = "Error: OPENROUTER_API_KEY environment variable is not configured.";
    } else {
      const openrouterUrl = "https://openrouter.ai/api/v1/chat/completions";
      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      if (Array.isArray(history)) {
        history.forEach((h: any) => {
          messages.push({ role: h.role || "user", content: h.content || "" });
        });
      }
      messages.push({ role: "user", content: message });
      
      try {
        const fetchRes = await fetch(openrouterUrl, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "AI Studio Workspace"
          },
          body: JSON.stringify({
            model: model || "openrouter/free",
            messages,
            temperature: 0.2
          })
        });
        
        if (fetchRes.ok) {
          const json: any = await fetchRes.json();
          llmResponse = json.choices?.[0]?.message?.content || "";
          actualModel = json.model || model || "openrouter/free";
        } else {
          const errBody = await fetchRes.text();
          throw new Error(`OpenRouter returned status ${fetchRes.status}: ${errBody}`);
        }
      } catch (err: any) {
        llmResponse = `OpenRouter API error: ${err.message}`;
      }
    }
  } else if (selectedProvider === "gemini" && process.env.GEMINI_API_KEY) {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    
    const contents: any[] = [];
    if (Array.isArray(history)) {
      history.forEach((h: any) => {
        const role = h.role === "user" ? "user" : "model";
        contents.push({
          role,
          parts: [{ text: h.content || "" }]
        });
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });
    
    const config: any = {
      systemInstruction: systemPrompt,
      temperature: 0.2,
    };
    if (forceJson) {
      config.responseMimeType = "application/json";
    }
    
    const response = await ai.models.generateContent({
      model: model || "gemini-3.5-flash",
      contents,
      config
    });
    
    llmResponse = response.text || "";
    actualModel = model || "gemini-3.5-flash";
  } else {
    // Ollama/Local Fallback
    const ollamaUrl = "http://localhost:11434/api/chat";
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    if (Array.isArray(history)) {
      history.forEach((h: any) => {
        messages.push({ role: h.role, content: h.content || "" });
      });
    }
    messages.push({ role: "user", content: message });
    
    try {
      const fetchRes = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3",
          messages,
          stream: false,
          options: { temperature: 0.2 }
        })
      });
      
      if (fetchRes.ok) {
        const json: any = await fetchRes.json();
        llmResponse = json.message?.content || "";
        actualModel = json.model || model || "llama3";
      } else {
        throw new Error(`Ollama returned status ${fetchRes.status}`);
      }
    } catch (ollamaErr: any) {
      // Safe mockup generator to allow seamless demo execution
      const lower = message.toLowerCase();
      if (lower.includes("create") || lower.includes("write") || lower.includes("buat") || lower.includes("tulis") || lower.includes("baca") || lower.includes("read") || lower.includes("view") || lower.includes("scan")) {
        const mockManifest = {
          actions: [] as any[]
        };
        if (lower.includes("baca") || lower.includes("read") || lower.includes("view")) {
          mockManifest.actions.push({
            type: "read_file",
            path: "src/App.tsx"
          });
        } else if (lower.includes("scan") || lower.includes("direktori")) {
          mockManifest.actions.push({
            type: "scan_directory",
            path: "src"
          });
        } else {
          mockManifest.actions.push({
            type: "write_file",
            path: "test.txt",
            content: "Halo Dunia dari Human-Assisted AI Agent!"
          });
        }
        llmResponse = JSON.stringify(mockManifest, null, 2);
      } else {
        llmResponse = `Saya adalah Human-Assisted AI Agent. Sistem lokal mendeteksi endpoint Ollama sedang offline (${ollamaErr.message}).\n\nAnda bisa meminta saya membuat file dengan mengetik: "Tolong buat file test.txt" atau "baca src/App.tsx"`;
      }
      actualModel = model || "llama3";
    }
  }
  return { text: llmResponse, actualModel };
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history, provider = "ollama", model } = req.body;
    
    // 1. Retrieve relevant memory context from fallback store in Node.js
    let contextStr = "";
    const fallbackPath = getFallbackStorePath(CURRENT_WORKSPACE_ROOT);
    if (fs.existsSync(fallbackPath)) {
      try {
        const db = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
        if (db && Array.isArray(db.chunks)) {
          const queryTokens = message.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
          const scoredChunks = db.chunks.map((chunk: any) => {
            let score = 0;
            const contentLower = chunk.content.toLowerCase();
            const filenameLower = chunk.filename.toLowerCase();
            queryTokens.forEach((token: string) => {
              if (contentLower.includes(token)) score += 1;
              if (filenameLower.includes(token)) score += 2; // heavier weight for filename matches
            });
            return { chunk, score };
          }).filter((item: any) => item.score > 0)
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, 3);
            
          if (scoredChunks.length > 0) {
            contextStr = "\n--- RELEVANT CONTEXT FROM WORKSPACE MEMORY ---\n";
            scoredChunks.forEach((item: any) => {
              contextStr += `File: ${item.chunk.filename} (Score: ${item.score})\n`;
              contextStr += `Content:\n${item.chunk.content}\n`;
              contextStr += `----------------------------------------\n`;
            });
          }
        }
      } catch (err) {
        console.error("Node chat memory retrieval warning:", err);
      }
    }
    
    // 1.5 Retrieve long-term memories (facts about user and AI)
    const longTermMemories = readLongTermMemories(CURRENT_WORKSPACE_ROOT);
    const userMemories = longTermMemories.filter(m => m.category === "user");
    const aiMemories = longTermMemories.filter(m => m.category === "ai");

    let longTermContext = "";
    if (longTermMemories.length > 0) {
      longTermContext = "\n\n=== MEMORI JANGKA PANJANG (LONG-TERM MEMORIES) ===\n";
      longTermContext += "Sistem memori mendeteksi fakta-fakta berikut yang HARUS Anda ingat dan patuhi secara absolut:\n";
      if (userMemories.length > 0) {
        longTermContext += "\nFakta & Preferensi Pengguna (User):\n";
        userMemories.forEach(m => {
          longTermContext += `- ${m.content}\n`;
        });
      }
      if (aiMemories.length > 0) {
        longTermContext += "\nFakta & Aturan Perilaku Anda (Self/AI):\n";
        aiMemories.forEach(m => {
          longTermContext += `- ${m.content}\n`;
        });
      }
      longTermContext += "=================================================\n\n";
      longTermContext += "Ingat fakta di atas sepanjang percakapan ini. Jika ada informasi baru tentang pengguna atau diri Anda yang diungkapkan, diskusikan secara alami, dan sistem kami akan menyimpannya ke memori jangka panjang secara otomatis.\n";
    }

    const baseSystemPrompt = `
You are a "Human-Assisted AI Agent" operating under the strict proxy tool-use paradigm called "Proxy Tool-Use via UI Mediation".
You never execute actions on the filesystem directly. Instead, you propose action plans as structured JSON manifests.

Your output format is strictly bifurcated:
1. If you need to perform any filesystem operations (like reading, scanning, or writing files), you MUST output ONLY a valid JSON object matching the schema below. No greeting, no conversational text before or after the JSON block.
2. If you are just answering a general question, explaining a concept, or greeting the user without needing to touch files, you must output pure conversational text in Indonesian/English. No JSON code blocks.

ATURAN KEPUTUSAN OUTPUT (PENTING):
- JANGAN mengusulkan manifest JSON kecuali jika pengguna secara EKSPLISIT meminta operasi terhadap file atau direktori (seperti membaca, mengubah, membuat, atau menganalisis isi file/folder tertentu).
- Untuk pertanyaan konfirmasi, sapaan, perkenalan, atau pertanyaan umum yang tidak membutuhkan akses filesystem (contoh: "kamu bisa akses workspace ini?", "apakah kamu online?", "halo", "apa fungsi aplikasi ini?"), Anda harus menjawab dengan TEKS BIASA saja (conversational text) tanpa menyertakan manifest JSON.
- Jika Anda RAGU atau tidak yakin apakah pengguna benar-benar meminta aksi filesystem atau hanya sekadar bertanya/berdiskusi, Anda WAJIB bertanya balik terlebih dahulu menggunakan teks biasa untuk meminta klarifikasi, bukannya langsung mengusulkan manifest JSON.

--- SCHEMA FOR ACTION PROPOSALS ---
If proposing actions, your property MUST be a valid JSON object with the following schema:
{
  "actions": [
    {
      "type": "read_file",
      "path": "relative/path/to/file.tsx"
    },
    {
      "type": "scan_directory",
      "path": "relative/path/to/folder"
    },
    {
      "type": "write_file",
      "path": "relative/path/to/file.py",
      "content": "Full contents of the file here..."
    }
  ]
}

Aturan Penting Keamanan:
- Tipe aksi (type) hanya boleh berisi salah satu dari whitelist: "read_file", "scan_directory", "write_file".
- Semua path harus relatif terhadap root workspace. JANGAN gunakan path absolut atau path traversal (misal: "../") yang menunjuk ke luar workspace.
- Jika menulis file (write_file), Anda wajib menyertakan parameter "content" dengan isi lengkap file tersebut.
- Jangan berikan penjelasan teks apa pun di luar blok JSON jika Anda mengusulkan aksi. Output Anda harus berupa JSON utuh.
`;

    const systemPrompt = contextStr 
      ? `${baseSystemPrompt}\nUse the following retrieved context from the workspace vectors to accurately formulate your action manifest:\n${contextStr}${longTermContext}`
      : `${baseSystemPrompt}${longTermContext}`;
      
    // 2. Call the LLM helper
    const selectedProvider = provider.toLowerCase();
    const llmResult = await callLLM(message, history, selectedProvider, model, systemPrompt, true);
    
    // 3. Asynchronously run background memory extraction
    extractAndSaveMemories(message, llmResult.text, selectedProvider, model).catch(err => {
      console.error("[Memory] Background extraction failed:", err);
    });

    res.json({
      status: "success",
      response: llmResult.text,
      provider: selectedProvider,
      model: llmResult.actualModel || model || (selectedProvider === "gemini" ? "gemini-3.5-flash" : (selectedProvider === "openrouter" ? "openrouter/free" : "llama3")),
      has_context: contextStr !== ""
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.get("/api/providers", async (req, res) => {
  try {
    // Check Ollama
    let ollamaAccessible = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);
      const ollamaRes = await fetch("http://localhost:11434/", { signal: controller.signal });
      clearTimeout(timeoutId);
      if (ollamaRes.ok) {
        ollamaAccessible = true;
      }
    } catch (e) {
      ollamaAccessible = false;
    }

    // Check OpenRouter
    const openrouterConfigured = !!process.env.OPENROUTER_API_KEY;

    // Check Gemini
    const geminiConfigured = !!process.env.GEMINI_API_KEY;

    res.json({
      status: "success",
      providers: {
        ollama: {
          accessible: ollamaAccessible,
          configured: true
        },
        openrouter: {
          accessible: openrouterConfigured,
          configured: openrouterConfigured
        },
        gemini: {
          accessible: geminiConfigured,
          configured: geminiConfigured
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

// Workspace Switcher API endpoints:
app.get("/api/workspace/browse", (req, res) => {
  const requestedPath = req.query.path as string;
  
  if (!requestedPath) {
    // Return base list of ALLOWED_BASE_PATHS
    const dirs = ABSOLUTE_ALLOWED_BASE_PATHS.map(p => {
      return {
        name: path.basename(p) || p,
        path: p
      };
    });
    return res.json({
      status: "success",
      current_path: "",
      parent_path: null,
      directories: dirs
    });
  }

  // Validate path is inside allowed bases
  const val = isPathInAllowedBases(requestedPath);
  if (!val.safe) {
    return res.status(403).json({ status: "failed", error: val.error });
  }

  const absPath = val.resolvedPath;

  try {
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ status: "failed", error: "Folder tidak ditemukan." });
    }
    if (!fs.statSync(absPath).isDirectory()) {
      return res.status(400).json({ status: "failed", error: "Target bukan sebuah direktori." });
    }

    const items = fs.readdirSync(absPath);
    const directories: any[] = [];

    for (const name of items) {
      try {
        const fullPath = path.join(absPath, name);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          directories.push({
            name,
            path: fullPath
          });
        }
      } catch (e) {
        // Skip inaccessible folders
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    // Calculate parent path - return null if already at one of the BASE paths to prevent going higher
    let parentPath: string | null = path.dirname(absPath);
    const isAtBase = ABSOLUTE_ALLOWED_BASE_PATHS.some(base => base === absPath);
    if (isAtBase) {
      parentPath = null;
    }

    return res.json({
      status: "success",
      current_path: absPath,
      parent_path: parentPath,
      directories
    });
  } catch (err: any) {
    return res.status(500).json({ status: "failed", error: err.message });
  }
});

app.put("/api/workspace/set", (req, res) => {
  const targetPath = req.body.path as string;
  if (!targetPath) {
    return res.status(400).json({ status: "failed", error: "Parameter 'path' wajib dikirimkan." });
  }

  const val = isPathInAllowedBases(targetPath);
  if (!val.safe) {
    return res.status(403).json({ status: "failed", error: val.error });
  }

  const absPath = val.resolvedPath;

  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ status: "failed", error: "Folder yang dipilih tidak eksis di sistem." });
  }
  if (!fs.statSync(absPath).isDirectory()) {
    return res.status(400).json({ status: "failed", error: "Path yang dipilih bukan direktori." });
  }

  // Switch workspace
  CURRENT_WORKSPACE_ROOT = absPath;

  // Persist to recent_workspaces.json in process.cwd()
  try {
    const recentPath = path.join(process.cwd(), "recent_workspaces.json");
    let recentList: any[] = [];
    if (fs.existsSync(recentPath)) {
      try {
        recentList = JSON.parse(fs.readFileSync(recentPath, "utf-8"));
      } catch (e) {}
    }
    if (!Array.isArray(recentList)) {
      recentList = [];
    }

    recentList = recentList.filter((item: any) => item.path !== absPath);
    recentList.unshift({
      path: absPath,
      timestamp: Date.now()
    });

    recentList = recentList.slice(0, 10);
    fs.writeFileSync(recentPath, JSON.stringify(recentList, null, 2), "utf-8");
  } catch (err) {
    console.error("Gagal mencatat riwayat workspace baru:", err);
  }

  return res.json({
    status: "success",
    workspace_root: CURRENT_WORKSPACE_ROOT,
    message: "Workspace berhasil diganti secara dinamis."
  });
});

app.get("/api/workspace/recent", (req, res) => {
  try {
    const recentPath = path.join(process.cwd(), "recent_workspaces.json");
    let recentList: any[] = [];
    if (fs.existsSync(recentPath)) {
      try {
        recentList = JSON.parse(fs.readFileSync(recentPath, "utf-8"));
      } catch (e) {}
    }
    return res.json({
      status: "success",
      recent_workspaces: recentList
    });
  } catch (err: any) {
    return res.status(500).json({ status: "failed", error: err.message });
  }
});

app.post("/api/manifest/validate", (req, res) => {
  const { actions } = req.body || {};
  if (!Array.isArray(actions)) {
    return res.status(400).json({ valid: false, error: "'actions' must be an array." });
  }

  const report = validateManifest(actions, CURRENT_WORKSPACE_ROOT);
  res.json(report);
});

app.post("/api/manifest/execute", async (req, res) => {
  const { actions, history, provider = "gemini", model } = req.body || {};
  if (!Array.isArray(actions)) {
    return res.status(400).json({ status: "failed", error: "'actions' must be an array." });
  }

  const { valid, results } = validateManifest(actions, CURRENT_WORKSPACE_ROOT);
  if (!valid) {
    return res.json({
      status: "failed",
      report: results.map(r => ({
        index: r.index,
        type: r.action?.type,
        path: r.action?.path,
        status: "failed",
        error: r.valid ? "Execution aborted due to prior failures" : r.error,
        result: null
      }))
    });
  }

  const report = [];
  let halted = false;
  const executionId = `exec_${Date.now()}`;
  executionBackups[executionId] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const valInfo = results[i];
    const resolvedPath = valInfo.resolved_path;

    if (halted) {
      report.push({
        index: i,
        type: action.type,
        path: action.path,
        status: "pending",
        error: "Execution halted due to a previous step failure.",
        result: null
      });
      continue;
    }

    try {
      if (action.type === "read_file") {
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`File not found: ${action.path}`);
        }
        if (fs.statSync(resolvedPath).isDirectory()) {
          throw new Error(`Path is a directory: ${action.path}`);
        }
        const content = fs.readFileSync(resolvedPath, "utf-8");
        
        // Index the file in our Vector Store Fallback
        indexOrUpdateFileInStore(resolvedPath, content);

        report.push({
          index: i,
          type: action.type,
          path: action.path,
          status: "success",
          error: "",
          result: { content }
        });
      } else if (action.type === "scan_directory") {
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Directory not found: ${action.path}`);
        }
        if (!fs.statSync(resolvedPath).isDirectory()) {
          throw new Error(`Path is not a directory: ${action.path}`);
        }
        const items = fs.readdirSync(resolvedPath).map(name => {
          const itemPath = path.join(resolvedPath, name);
          const stat = fs.statSync(itemPath);
          return {
            name,
            type: stat.isDirectory() ? "directory" : "file",
            size: stat.size,
            modified: stat.mtimeMs
          };
        });
        // Sort directories first, then files
        items.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "directory" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        report.push({
          index: i,
          type: action.type,
          path: action.path,
          status: "success",
          error: "",
          result: { items }
        });
      } else if (action.type === "write_file") {
        const parentDir = path.dirname(resolvedPath);
        
        // Backup original content
        const exists = fs.existsSync(resolvedPath);
        const previousContent = exists ? fs.readFileSync(resolvedPath, "utf-8") : null;
        executionBackups[executionId].push({
          path: resolvedPath,
          previousContent
        });

        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(resolvedPath, action.content, "utf-8");

        // Index the written file in our Vector Store Fallback
        indexOrUpdateFileInStore(resolvedPath, action.content);

        report.push({
          index: i,
          type: action.type,
          path: action.path,
          status: "success",
          error: "",
          result: "File written successfully"
        });
      }
    } catch (err: any) {
      halted = true;
      report.push({
        index: i,
        type: action.type,
        path: action.path,
        status: "failed",
        error: err.message,
        result: null
      });
    }
  }

  let ai_response = "";
  try {
    const resultsSummary = report.map(r => {
      let resStr = "";
      if (r.type === "read_file" && r.status === "success" && r.result?.content) {
        const content = r.result.content;
        const displayContent = content.length > 5000 ? content.slice(0, 5000) + "\n...[TRUNCATED]..." : content;
        resStr = `Content:\n${displayContent}`;
      } else if (r.type === "scan_directory" && r.status === "success" && r.result?.items) {
        resStr = `Directory Items:\n${JSON.stringify(r.result.items, null, 2)}`;
      } else if (r.type === "write_file") {
        resStr = r.status === "success" ? "File written successfully." : `Failed: ${r.error}`;
      } else {
        resStr = r.error ? `Error: ${r.error}` : "Status: " + r.status;
      }
      return `Action #${r.index + 1} (${r.type} on "${r.path}"):
Status: ${r.status}
${resStr}`;
    }).join("\n---\n");

    const executionPrompt = `
The user has executed the proposed manifest of actions. Below are the sequential execution results for each action:

${resultsSummary}

Please analyze these results and explain them to the user in a friendly, conversational, and natural language response (Indonesian/English, matching the language of their request or Indonesian by default).
- For scan_directory: Summarize the folder structure, listing key directories and files found.
- For read_file: Summarize the content of the file and its significance.
- For write_file: Confirm whether the file was successfully written, explaining what has been modified or created.
- If any action failed: Clearly explain what went wrong and how they can address it.

Do NOT output raw JSON or code blocks. Speak directly and professionally to the user as a helpful AI Coding Agent.
`;

    const systemPrompt = "You are a helpful AI Coding Agent. Answer the user in a natural, friendly conversational format.";
    const llmResult = await callLLM(executionPrompt, history || [], provider, model, systemPrompt, false);
    ai_response = llmResult.text;
    res.json({
      status: halted ? "failed" : "success",
      executionId,
      report,
      ai_response,
      actual_model: llmResult.actualModel || model
    });
  } catch (llmErr: any) {
    console.error("Failed to generate execution explanation:", llmErr);
    res.json({
      status: halted ? "failed" : "success",
      executionId,
      report,
      ai_response: `Eksekusi selesai dengan status ${halted ? "gagal" : "sukses"}. Namun, gagal menghasilkan penjelasan AI: ${llmErr.message}`,
      actual_model: model
    });
  }
});

app.post("/api/manifest/rollback", (req, res) => {
  const { executionId } = req.body || {};
  if (!executionId) {
    return res.status(400).json({ status: "failed", error: "Missing 'executionId' parameter." });
  }

  const backups = executionBackups[executionId];
  if (!backups) {
    return res.status(404).json({ status: "failed", error: "No backup found for this execution." });
  }

  try {
    const rolledBack = [];
    for (const backup of backups) {
      if (backup.previousContent === null) {
        // File did not exist before, so delete it if it exists
        if (fs.existsSync(backup.path)) {
          fs.unlinkSync(backup.path);
          rolledBack.push({ path: backup.path, action: "deleted" });
        }
      } else {
        // Restore previous content
        const parentDir = path.dirname(backup.path);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(backup.path, backup.previousContent, "utf-8");
        indexOrUpdateFileInStore(backup.path, backup.previousContent);
        rolledBack.push({ path: backup.path, action: "restored" });
      }
    }

    // Delete backup after successful rollback
    delete executionBackups[executionId];

    res.json({
      status: "success",
      message: "Manifest changes rolled back successfully.",
      rolled_back: rolledBack
    });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.get("/api/manifest/backups", (req, res) => {
  try {
    const list = Object.keys(executionBackups).map(id => {
      const timestampStr = id.replace("exec_", "");
      const timestamp = parseInt(timestampStr, 10) || Date.now();
      
      const files = executionBackups[id].map(b => {
        const relativePath = path.relative(CURRENT_WORKSPACE_ROOT, b.path).replace(/\\/g, "/");
        return {
          path: relativePath,
          action: b.previousContent === null ? "created" : "modified"
        };
      });

      return {
        executionId: id,
        timestamp,
        files
      };
    }).sort((a, b) => b.timestamp - a.timestamp);

    res.json({ status: "success", backups: list });
  } catch (err: any) {
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.post("/api/manifest/backups/commit", (req, res) => {
  const { executionId } = req.body || {};
  if (!executionId) {
    return res.status(400).json({ status: "failed", error: "Missing 'executionId' parameter." });
  }

  if (executionBackups[executionId]) {
    delete executionBackups[executionId];
    return res.json({ status: "success", message: "Backup successfully committed and removed." });
  } else {
    return res.status(404).json({ status: "failed", error: "Backup not found." });
  }
});

// Setup WebSocket Server for WS /ws/execution
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws: WebSocket) => {
  ws.on("message", async (messageData: string) => {
    try {
      const payload = JSON.parse(messageData);
      const { actions, history, provider = "gemini", model } = payload || {};

      if (!Array.isArray(actions) || actions.length === 0) {
        ws.send(JSON.stringify({ event: "error", message: "Invalid action list in manifest." }));
        return;
      }

      // Preflight check
      const { valid, results } = validateManifest(actions, CURRENT_WORKSPACE_ROOT);
      if (!valid) {
        const invalidDetails = results
          .filter(r => !r.valid)
          .map(r => ({ index: r.index, error: r.error }));
        ws.send(JSON.stringify({
          event: "preflight_failed",
          errors: invalidDetails,
          message: "Execution aborted: one or more actions failed pre-flight security validation."
        }));
        return;
      }

      // Start execution step-by-step
      const executionId = `exec_${Date.now()}`;
      executionBackups[executionId] = [];

      ws.send(JSON.stringify({
        event: "started",
        executionId,
        total_actions: actions.length,
        actions: actions.map((action, i) => ({
          index: i,
          type: action.type,
          path: action.path,
          status: "pending"
        }))
      }));

      let halted = false;
      const report: any[] = [];

      for (let i = 0; i < actions.length; i++) {
        if (halted) {
          ws.send(JSON.stringify({
            event: "step_update",
            index: i,
            status: "aborted",
            error: "Prior step failed. Sequential execution halted."
          }));
          report.push({
            index: i,
            type: actions[i].type,
            path: actions[i].path,
            status: "aborted",
            error: "Prior step failed. Sequential execution halted.",
            result: null
          });
          continue;
        }

        const action = actions[i];
        const valInfo = results[i];
        const resolvedPath = valInfo.resolved_path;

        // Broadcast step start
        ws.send(JSON.stringify({
          event: "step_update",
          index: i,
          status: "running"
        }));

        // Artificial small delay to make the real-time visual step streaming fully clear in the UI
        await new Promise(resolve => setTimeout(resolve, 400));

        try {
          let result: any = null;
          if (action.type === "read_file") {
            if (!fs.existsSync(resolvedPath)) throw new Error(`File not found: ${action.path}`);
            const content = fs.readFileSync(resolvedPath, "utf-8");
            
            // Index the file in our Vector Store Fallback
            indexOrUpdateFileInStore(resolvedPath, content);

            result = { content };
          } else if (action.type === "scan_directory") {
            if (!fs.existsSync(resolvedPath)) throw new Error(`Directory not found: ${action.path}`);
            const items = fs.readdirSync(resolvedPath).map(name => {
              const itemPath = path.join(resolvedPath, name);
              const stat = fs.statSync(itemPath);
              return {
                name,
                type: stat.isDirectory() ? "directory" : "file",
                size: stat.size,
                modified: stat.mtimeMs
              };
            });
            items.sort((a, b) => {
              if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            result = { items };
          } else if (action.type === "write_file") {
            // Backup original content before writing
            const exists = fs.existsSync(resolvedPath);
            const previousContent = exists ? fs.readFileSync(resolvedPath, "utf-8") : null;
            executionBackups[executionId].push({
              path: resolvedPath,
              previousContent
            });

            const parentDir = path.dirname(resolvedPath);
            if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
            fs.writeFileSync(resolvedPath, action.content, "utf-8");

            // Index the written file in our Vector Store Fallback
            indexOrUpdateFileInStore(resolvedPath, action.content);

            result = "File written successfully";
          }

          // Broadcast step success
          ws.send(JSON.stringify({
            event: "step_update",
            index: i,
            status: "success",
            result
          }));

          report.push({
            index: i,
            type: action.type,
            path: action.path,
            status: "success",
            error: "",
            result
          });
        } catch (err: any) {
          halted = true;
          ws.send(JSON.stringify({
            event: "step_update",
            index: i,
            status: "failed",
            error: err.message
          }));

          report.push({
            index: i,
            type: action.type,
            path: action.path,
            status: "failed",
            error: err.message,
            result: null
          });
        }
      }

      let ai_response = "";
      try {
        const resultsSummary = report.map(r => {
          let resStr = "";
          if (r.type === "read_file" && r.status === "success" && r.result?.content) {
            const content = r.result.content;
            const displayContent = content.length > 5000 ? content.slice(0, 5000) + "\n...[TRUNCATED]..." : content;
            resStr = `Content:\n${displayContent}`;
          } else if (r.type === "scan_directory" && r.status === "success" && r.result?.items) {
            resStr = `Directory Items:\n${JSON.stringify(r.result.items, null, 2)}`;
          } else if (r.type === "write_file") {
            resStr = r.status === "success" ? "File written successfully." : `Failed: ${r.error}`;
          } else {
            resStr = r.error ? `Error: ${r.error}` : "Status: " + r.status;
          }
          return `Action #${r.index + 1} (${r.type} on "${r.path}"):
Status: ${r.status}
${resStr}`;
        }).join("\n---\n");

        const executionPrompt = `
The user has executed the proposed manifest of actions. Below are the sequential execution results for each action:

${resultsSummary}

Please analyze these results and explain them to the user in a friendly, conversational, and natural language response (Indonesian/English, matching the language of their request or Indonesian by default).
- For scan_directory: Summarize the folder structure, listing key directories and files found.
- For read_file: Summarize the content of the file and its significance.
- For write_file: Confirm whether the file was successfully written, explaining what has been modified or created.
- If any action failed: Clearly explain what went wrong and how they can address it.

Do NOT output raw JSON or code blocks. Speak directly and professionally to the user as a helpful AI Coding Agent.
`;

        const systemPrompt = "You are a helpful AI Coding Agent. Answer the user in a natural, friendly conversational format.";
        const llmResult = await callLLM(executionPrompt, history || [], provider, model, systemPrompt, false);
        ai_response = llmResult.text;
        
        ws.send(JSON.stringify({
          event: "completed",
          success: !halted,
          executionId,
          ai_response,
          actual_model: llmResult.actualModel || model
        }));
      } catch (llmErr: any) {
        console.error("Failed to generate execution explanation in websocket:", llmErr);
        ws.send(JSON.stringify({
          event: "completed",
          success: !halted,
          executionId,
          ai_response: `Eksekusi selesai dengan status ${halted ? "gagal" : "sukses"}. Namun, gagal menghasilkan penjelasan AI: ${llmErr.message}`,
          actual_model: model
        }));
      }

    } catch (err: any) {
      ws.send(JSON.stringify({ event: "error", message: `Socket processing error: ${err.message}` }));
    }
  });
});

// Upgrade HTTP server connections to WS at '/ws/execution'
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;

  if (pathname === "/ws/execution") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Initialize Vite integration or static file serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[FULLSTACK SERVER] running on http://localhost:${PORT}`);
  });
}

startServer();
