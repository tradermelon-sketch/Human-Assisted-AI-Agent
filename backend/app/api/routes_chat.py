from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from backend.app.core.router import ModelRouter
from backend.app.memory.store import memory_store

router = APIRouter()

class ChatMessageModel(BaseModel):
    role: str = Field(..., description="Role: 'user' or 'assistant'")
    content: str = Field(..., description="Message contents")

class ChatPayload(BaseModel):
    message: str = Field(..., description="The latest user message")
    history: Optional[List[Dict[str, str]]] = Field(None, description="Previous chat session history messages")
    provider: Optional[str] = Field("ollama", description="LLM provider: 'ollama' or 'gemini'")
    model: Optional[str] = Field(None, description="Model alias/name")

# ==============================================================================
# SYSTEM PROMPT FOR THE PROXY TOOL-USE PARADIGM
# This is the security and behavioral core of our system prompt.
# It enforces structural isolation: the AI MUST NOT output inline commands,
# scripts, or text-heavy explanations mixed with raw JSON. It must return EITHER
# a single valid JSON action manifest OR pure conversational text.
# ==============================================================================
SYSTEM_PROMPT = """
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
If proposing actions, your output MUST be a valid JSON object with the following schema:
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
"""

@router.post("/chat")
async def chat_endpoint(request: Request, payload: ChatPayload):
    """
    Endpoint: POST /api/chat
    
    Processes the chat interaction, queries the vector memory store for relevant context,
    assembles the prompt, and gets the LLM response from the ModelRouter.
    
    Why this decision was taken:
    - Injecting relevant file fragments (retrieved via top_k_search) directly as context
      allows the agent to keep reference information in mind (like schemas or API interfaces)
      without flooding the context window with the entire repository.
    - We support Ollama and Gemini models seamlessly.
    """
    try:
        user_message = payload.message
        
        # 1. Retrieve relevant memory context from the Vector Store
        context_str = ""
        try:
            relevant_chunks = memory_store.top_k_search(user_message, k=3)
            if relevant_chunks:
                context_str = "\n--- RELEVANT CONTEXT FROM WORKSPACE MEMORY ---\n"
                for chunk in relevant_chunks:
                    context_str += f"File: {chunk['filename']} (Score: {chunk['score']:.2f})\n"
                    context_str += f"Content:\n{chunk['content']}\n"
                    context_str += "----------------------------------------\n"
        except Exception as mem_err:
            # Degrade gracefully if memory retrieval fails
            print(f"Memory retrieval warning: {mem_err}")
            
        # 2. Build the final prompt combining system instructions, retrieved workspace context, and user input
        full_system_prompt = SYSTEM_PROMPT
        if context_str:
            full_system_prompt += f"\nUse the following retrieved context from the workspace vectors to accurately formulate your action manifest:\n{context_str}"
            
        # 3. Call Model Router to generate chat completion
        router_instance = ModelRouter(
            provider=payload.provider or "ollama",
            model_name=payload.model
        )
        
        # Convert Pydantic payload history list to pure dictionaries if present
        history_list = []
        if payload.history:
            history_list = [dict(h) for h in payload.history]
            
        llm_response = router_instance.generate_chat_completion(
            system_prompt=full_system_prompt,
            user_message=user_message,
            history=history_list
        )
        
        # 4. Return response
        return {
            "status": "success",
            "response": llm_response,
            "provider": router_instance.provider,
            "model": router_instance.model_name,
            "has_context": bool(context_str)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat generation error: {str(e)}")

@router.get("/providers")
async def get_providers():
    """
    Endpoint: GET /api/providers
    Returns status of each provider.
    """
    import os
    import urllib.request
    
    # Check Ollama
    ollama_accessible = False
    try:
        req = urllib.request.Request("http://localhost:11434/", method="GET")
        with urllib.request.urlopen(req, timeout=0.5) as response:
            if response.status == 200:
                ollama_accessible = True
    except Exception:
        ollama_accessible = False

    # Check OpenRouter
    openrouter_configured = bool(os.environ.get("OPENROUTER_API_KEY"))
    
    # Check Gemini
    gemini_configured = bool(os.environ.get("GEMINI_API_KEY"))
    
    return {
        "status": "success",
        "providers": {
            "ollama": {
                "accessible": ollama_accessible,
                "configured": True
            },
            "openrouter": {
                "accessible": openrouter_configured,
                "configured": openrouter_configured
            },
            "gemini": {
                "accessible": gemini_configured,
                "configured": gemini_configured
            }
        }
    }
