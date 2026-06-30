import React, { useState, useEffect } from "react";
import { 
  Layers, Terminal, HardDrive, Search, RefreshCw, Loader2, FolderOpen, RotateCcw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ChatMessage, ActionManifest, Action } from "./types";
import ChatPanel from "./components/ChatPanel";
import ManifestTable from "./components/ManifestTable";
import ExecutionQueue from "./components/ExecutionQueue";
import MemoryExplorer from "./components/MemoryExplorer";
import BackupExplorer from "./components/BackupExplorer";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import { useExecutionSocket } from "./hooks/useExecutionSocket";

// Utility to extract JSON manifest from text
function extractManifest(text: string): ActionManifest | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && Array.isArray(parsed.actions)) {
        return parsed as ActionManifest;
      }
    }
  } catch (e) {
    // Return null if not valid json
  }
  return null;
}

export default function App() {
  // Chat States
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Tab Navigation on Right Side
  const [activeTab, setActiveTab] = useState<"manifest" | "execution" | "memory" | "backup">("manifest");
  
  // Selected Manifest under Review
  const [activeManifest, setActiveManifest] = useState<ActionManifest | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [executedMessageIds, setExecutedMessageIds] = useState<string[]>([]);

  // Workspace Switcher States
  const [currentWorkspace, setCurrentWorkspace] = useState<string>("");
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const [lastProvider, setLastProvider] = useState<string>("gemini");
  const [lastModel, setLastModel] = useState<string>("gemini-3.5-flash");
  const [actualActiveModel, setActualActiveModel] = useState<string | null>(null);

  // Custom execution hook for WebSocket execution channel management
  const {
    isExecuting,
    executionSteps,
    executionLogs,
    executionSuccess,
    executeManifest,
    resetExecution,
    executionId,
    rollbackExecution,
    isRollingBack,
    rollbackSuccess
  } = useExecutionSocket({
    onExecutionCompleted: (success, aiResponse, actualModel) => {
      if (actualModel) {
        setActualActiveModel(actualModel);
      }
      if (aiResponse) {
        setMessages(prev => [
          ...prev,
          {
            id: `assistant-explanation-${Date.now()}`,
            role: "assistant",
            content: aiResponse,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      }
    }
  });
  
  // Memory States
  const [memoryFiles, setMemoryFiles] = useState<any[]>([]);
  const [isFetchingMemory, setIsFetchingMemory] = useState(false);
  const [memorySearch, setMemorySearch] = useState("");

  // Load Initial Workspace Root, Memory Status & System Welcome
  useEffect(() => {
    const fetchInitialWorkspace = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          const data = await res.json();
          if (data.workspace_root) {
            setCurrentWorkspace(data.workspace_root);
          }
        }
      } catch (err) {
        console.error("Failed to load initial workspace root:", err);
      }
    };

    fetchInitialWorkspace();
    fetchMemoryStatus();
    
    // Insert welcome greeting message
    setMessages([
      {
        id: "welcome-msg",
        role: "assistant",
        content: "Halo! Saya adalah Human-Assisted AI Agent. Saya dapat membaca direktori, menganalisis struktur file, dan mengusulkan modifikasi kode dalam format Manifest JSON.\n\nSilakan instruksikan saya untuk melakukan operasi di workspace ini.",
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  }, []);

  // Clear notification timer
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Sync memory list on successful execution
  useEffect(() => {
    if (executionSuccess === true) {
      fetchMemoryStatus();
    }
  }, [executionSuccess]);

  // Fetch Vector Memory Index (Chroma/JSON Fallback Store)
  const fetchMemoryStatus = async () => {
    setIsFetchingMemory(true);
    try {
      const res = await fetch("/api/memory/status");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.indexed_files)) {
          setMemoryFiles(data.indexed_files);
        }
      }
    } catch (err) {
      console.error("Failed to fetch memory status:", err);
    } finally {
      setIsFetchingMemory(false);
    }
  };

  // Send message to back-end chat route
  const handleSendMessage = async (text: string, provider: string, model: string, onlineSearch: boolean) => {
    setLastProvider(provider);
    setLastModel(model);
    const userMsgId = `user-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Assemble history context
      const historyPayload = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: historyPayload,
          provider,
          model,
          onlineSearch
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned error status ${response.status}`);
      }

      const data = await response.json();
      if (data.model) {
        setActualActiveModel(data.model);
      }
      const rawResponse = data.response || "";
      const parsed = extractManifest(rawResponse);

      const botMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: rawResponse,
        timestamp: new Date().toLocaleTimeString(),
        parsedManifest: parsed,
        sources: data.sources || []
      };

      setMessages(prev => [...prev, botMessage]);

      // If a manifest has been proposed, auto-focus/disclose and trigger validation
      if (parsed) {
        handleSelectManifest(parsed, botMessage.id);
      }

      // Update the Vector Ledger to make sure file changes are caught
      fetchMemoryStatus();

    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Maaf, terjadi kesalahan saat menghubungi server chat: ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Retry / Regenerate last agent response to prevent double commands
  const handleRetryMessage = async (messageId: string, provider: string, model: string, onlineSearch: boolean) => {
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    // Find the nearest user message before this assistant message
    let userMsgIndex = -1;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userMsgIndex = i;
        break;
      }
    }

    if (userMsgIndex === -1) return;

    const userMessage = messages[userMsgIndex];
    setLastProvider(provider);
    setLastModel(model);

    // History is all messages before the user message
    const historyPayload = messages.slice(0, userMsgIndex).map(m => ({
      role: m.role,
      content: m.content
    }));

    // Remove the retried assistant message and any messages after the user message in history
    setMessages(prev => prev.slice(0, userMsgIndex + 1));
    
    // Clear active manifest if it was tied to the retried message
    if (activeMessageId === messageId) {
      setActiveManifest(null);
      setActiveMessageId(null);
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          history: historyPayload,
          provider,
          model,
          onlineSearch
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned error status ${response.status}`);
      }

      const data = await response.json();
      if (data.model) {
        setActualActiveModel(data.model);
      }
      const rawResponse = data.response || "";
      const parsed = extractManifest(rawResponse);

      const botMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: rawResponse,
        timestamp: new Date().toLocaleTimeString(),
        parsedManifest: parsed,
        sources: data.sources || []
      };

      setMessages(prev => [...prev, botMessage]);

      if (parsed) {
        handleSelectManifest(parsed, botMessage.id);
      }

      fetchMemoryStatus();

    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Maaf, terjadi kesalahan saat menghubungi server chat: ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Review manifest action click
  const handleSelectManifest = (manifest: ActionManifest, messageId: string) => {
    setActiveManifest(manifest);
    setActiveMessageId(messageId);
    
    // Disclose immediately by opening Manifest tab
    setActiveTab("manifest");
  };

  // Clear under review manifest selection
  const handleClearReview = () => {
    setActiveManifest(null);
    setActiveMessageId(null);
  };

  // Handler for execute action triggered by ManifestTable
  const handleExecuteManifest = (actions: Action[]) => {
    const historyPayload = messages.map(m => ({
      role: m.role,
      content: m.content
    }));
    executeManifest(actions, historyPayload, lastProvider, lastModel);
    if (activeMessageId) {
      setExecutedMessageIds(prev => [...prev, activeMessageId]);
    }
    setActiveTab("execution");
  };

  // Handle active workspace swap and clear obsolete states
  const handleWorkspaceChanged = (newPath: string) => {
    setCurrentWorkspace(newPath);
    setNotification(`Workspace berhasil dipindahkan ke: ${newPath}`);
    
    // Reset state Manifest/Execution/Memory panel di sisi kanan ke kondisi awal (kosong)
    setActiveManifest(null);
    setActiveMessageId(null);
    resetExecution();
    
    // Fetch memory status for the newly selected workspace root directory immediately
    fetchMemoryStatus();
  };

  // Filtered Memory files
  const filteredMemoryFiles = memoryFiles.filter(f => 
    f.filename.toLowerCase().includes(memorySearch.toLowerCase()) ||
    f.hash.toLowerCase().includes(memorySearch.toLowerCase())
  );

  return (
    <div className="flex h-screen w-screen bg-[#0d1117] text-gray-200 overflow-hidden font-sans" id="app-root">
      
      {/* LEFT COLUMN: CHAT PANEL (~40% desktop layout, with adaptive fluid boundary) */}
      <div className="w-full md:w-[40%] lg:w-[38%] xl:w-[35%] flex flex-col h-full border-r border-[#30363d] flex-shrink-0">
        <ChatPanel 
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          onSelectManifest={handleSelectManifest}
          activeManifestMessageId={activeMessageId}
          actualActiveModel={actualActiveModel}
          onRetryMessage={handleRetryMessage}
        />
      </div>

      {/* RIGHT COLUMN: WORKSPACE MONITOR & CONTROL PANEL (~60% layout) */}
      <div className="hidden md:flex flex-col flex-1 h-full bg-[#0d1117] overflow-hidden" id="control-panel-container">
        
        {/* Navigation Tabs Header */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-[#161b22] border-b border-[#30363d] h-[53px]">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setActiveTab("manifest")}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
                activeTab === "manifest"
                  ? "bg-[#21262d] text-[#58a6ff] border border-[#30363d]"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              id="tab-btn-manifest"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>MANIFEST PROPOSAL</span>
              {activeManifest && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#e1b434] animate-pulse"></span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("execution")}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
                activeTab === "execution"
                  ? "bg-[#21262d] text-[#58a6ff] border border-[#30363d]"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              id="tab-btn-execution"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>EKSEKUSI MANIFEST</span>
              {isExecuting && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("memory")}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
                activeTab === "memory"
                  ? "bg-[#21262d] text-[#58a6ff] border border-[#30363d]"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              id="tab-btn-memory"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>LEDGER MEMORI</span>
              <span className="text-[10px] font-mono px-1 bg-[#30363d] rounded text-gray-300">
                {memoryFiles.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("backup")}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
                activeTab === "backup"
                  ? "bg-[#21262d] text-[#58a6ff] border border-[#30363d]"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              id="tab-btn-backup"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>SNAPSHOT CADANGAN</span>
            </button>
          </div>

          <div className="flex items-center space-x-3">
            {/* Clickable Workspace Indicator */}
            <button
              onClick={() => setIsSwitcherOpen(true)}
              className="flex items-center space-x-2 px-2.5 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-mono text-gray-300 transition-all hover:border-[#58a6ff]/50 cursor-pointer"
              title="Klik untuk ganti workspace/folder proyek aktif"
              id="active-workspace-indicator"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span className="max-w-[130px] lg:max-w-[180px] xl:max-w-[220px] truncate text-left font-mono text-[11px]">
                {currentWorkspace ? currentWorkspace.split(/[\\\/]/).pop() || currentWorkspace : "Pilih Workspace"}
              </span>
            </button>

            <span className="hidden sm:inline-block text-[11px] font-mono text-gray-500 uppercase">
              SANDBOX ISOLASI: SECURE
            </span>
          </div>
        </div>

        {/* Dynamic Panel Content Container with AnimatePresence for soft page swaps */}
        <div className="flex-1 overflow-hidden relative">
          {notification && (
            <div 
              className="absolute top-4 right-4 bg-[#1f242c] border border-emerald-500/40 text-emerald-400 text-xs px-4 py-3 rounded-lg shadow-2xl z-40 flex items-center space-x-2.5 font-mono"
              id="workspace-change-toast"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{notification}</span>
            </div>
          )}

          {isSwitcherOpen && (
            <WorkspaceSwitcher
              currentRoot={currentWorkspace}
              onClose={() => setIsSwitcherOpen(false)}
              onWorkspaceChanged={handleWorkspaceChanged}
            />
          )}
          <AnimatePresence mode="wait">
            
            {/* 1. MANIFEST PROPOSAL TAB */}
            {activeTab === "manifest" && (
              <motion.div
                key="manifest-tab"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="h-full overflow-hidden"
                id="panel-manifest-view"
              >
                {!activeManifest ? (
                  /* Empty State Blueprint */
                  <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-[#090d13]">
                    <div className="p-4 bg-[#161b22] rounded-full border border-[#30363d] mb-4">
                      <Layers className="w-10 h-10 text-gray-500" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-300">Tidak Ada Manifest Aktif</h3>
                    <p className="text-xs text-gray-400 mt-1.5 max-w-sm leading-relaxed">
                      Instruksikan agen di panel percakapan untuk mengedit file atau menscan direktori. Setelah agen mengusulkan manifest, klik tombol <strong className="text-[#58a6ff]">Review Manifest</strong> untuk membukanya di sini.
                    </p>
                  </div>
                ) : (
                  /* Modular Manifest Inspector */
                  <ManifestTable
                    manifest={activeManifest}
                    messageId={activeMessageId || ""}
                    onClose={handleClearReview}
                    onExecute={handleExecuteManifest}
                    isExecuting={isExecuting}
                    isExecuted={activeMessageId ? executedMessageIds.includes(activeMessageId) : false}
                  />
                )}
              </motion.div>
            )}

            {/* 2. LIVE EXECUTION TAB */}
            {activeTab === "execution" && (
              <motion.div
                key="execution-tab"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="h-full overflow-hidden"
                id="panel-execution-view"
              >
                <ExecutionQueue
                  isExecuting={isExecuting}
                  executionSteps={executionSteps}
                  executionLogs={executionLogs}
                  executionSuccess={executionSuccess}
                  onReset={resetExecution}
                  executionId={executionId}
                  rollbackExecution={rollbackExecution}
                  isRollingBack={isRollingBack}
                  rollbackSuccess={rollbackSuccess}
                />
              </motion.div>
            )}

            {/* 3. VECTOR STORAGE LEDGER TAB */}
            {activeTab === "memory" && (
              <motion.div
                key="memory-tab"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="h-full overflow-hidden"
                id="panel-memory-view"
              >
                <MemoryExplorer
                  files={memoryFiles}
                  isLoading={isFetchingMemory}
                  onRefresh={fetchMemoryStatus}
                />
              </motion.div>
            )}

            {/* 4. SNAPSHOT BACKUP EXPLORER TAB */}
            {activeTab === "backup" && (
              <motion.div
                key="backup-tab"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="h-full overflow-hidden"
                id="panel-backup-view"
              >
                <BackupExplorer
                  onRollbackTriggered={() => {
                    fetchMemoryStatus();
                    setNotification("Workspace berhasil dikembalikan dari cadangan!");
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
