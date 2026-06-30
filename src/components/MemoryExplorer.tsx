import React, { useState, useEffect } from "react";
import { 
  HardDrive, Search, RefreshCw, Loader2, Database, FileCode,
  Brain, User, Bot, Plus, Trash2, Edit2, Check, X, Sparkles, HelpCircle, AlertCircle
} from "lucide-react";
import { MemoryFile, LongTermMemoryFact } from "../types";

interface MemoryExplorerProps {
  files?: MemoryFile[];
  isLoading?: boolean;
  onRefresh?: () => void;
}

export default function MemoryExplorer({ files: propFiles, isLoading: propIsLoading, onRefresh }: MemoryExplorerProps) {
  const [internalFiles, setInternalFiles] = useState<MemoryFile[]>([]);
  const [internalLoading, setInternalLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Dual-view navigation
  const [activeSubTab, setActiveSubTab] = useState<"longterm" | "workspace">("longterm");

  // Long-Term Memory States
  const [longTermMemories, setLongTermMemories] = useState<LongTermMemoryFact[]>([]);
  const [isMemoriesLoading, setIsMemoriesLoading] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<"user" | "ai" | "knowledge">("user");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [memorySearch, setMemorySearch] = useState("");

  const isExternalState = propFiles !== undefined && propIsLoading !== undefined;
  const files = isExternalState ? propFiles! : internalFiles;
  const isLoading = isExternalState ? propIsLoading! : internalLoading;

  // Fetch File Index memories (Vektor)
  const fetchMemoryStatus = async () => {
    if (isExternalState && onRefresh) {
      onRefresh();
      return;
    }
    setInternalLoading(true);
    try {
      const res = await fetch("/api/memory/status");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.indexed_files)) {
          setInternalFiles(data.indexed_files);
        }
      }
    } catch (err) {
      console.error("Gagal memperbarui status memori berkas:", err);
    } finally {
      setInternalLoading(false);
    }
  };

  // Fetch Long Term memories (User & AI Facts)
  const fetchLongTermMemories = async () => {
    setIsMemoriesLoading(true);
    try {
      const res = await fetch("/api/long-term-memories");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.memories)) {
          setLongTermMemories(data.memories);
        }
      }
    } catch (err) {
      console.error("Gagal memuat memori jangka panjang:", err);
    } finally {
      setIsMemoriesLoading(false);
    }
  };

  useEffect(() => {
    if (!isExternalState) {
      fetchMemoryStatus();
    }
    fetchLongTermMemories();
  }, [isExternalState]);

  // Handle Add Memory
  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    try {
      const res = await fetch("/api/long-term-memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory, content: newContent.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && data.memory) {
          setLongTermMemories(prev => [...prev, data.memory]);
          setNewContent("");
        }
      }
    } catch (err) {
      console.error("Gagal menyimpan memori baru:", err);
    }
  };

  // Handle Delete Memory
  const handleDeleteMemory = async (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus memori jangka panjang ini?")) return;
    try {
      const res = await fetch(`/api/long-term-memories/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setLongTermMemories(prev => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error("Gagal menghapus memori:", err);
    }
  };

  // Trigger inline Edit
  const startEditing = (fact: LongTermMemoryFact) => {
    setEditingId(fact.id);
    setEditingContent(fact.content);
  };

  // Cancel inline Edit
  const cancelEditing = () => {
    setEditingId(null);
    setEditingContent("");
  };

  // Handle Save inline Edit
  const handleSaveEdit = async (id: string) => {
    if (!editingContent.trim()) return;
    try {
      const res = await fetch(`/api/long-term-memories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingContent.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && data.memory) {
          setLongTermMemories(prev => prev.map(m => m.id === id ? data.memory : m));
          setEditingId(null);
          setEditingContent("");
        }
      }
    } catch (err) {
      console.error("Gagal memperbarui memori:", err);
    }
  };

  const filteredFiles = files.filter(f =>
    f.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.hash.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredMemories = longTermMemories.filter(m =>
    m.content.toLowerCase().includes(memorySearch.toLowerCase())
  );

  const userMemories = filteredMemories.filter(m => m.category === "user");
  const aiMemories = filteredMemories.filter(m => m.category === "ai");
  const knowledgeMemories = filteredMemories.filter(m => m.category === "knowledge");

  return (
    <div className="flex flex-col h-full bg-[#0d1117] overflow-hidden" id="memory-explorer-root">
      
      {/* Tab Selector Header */}
      <div className="flex border-b border-[#30363d] bg-[#161b22] px-6 pt-3 gap-4 flex-shrink-0">
        <button
          onClick={() => setActiveSubTab("longterm")}
          className={`pb-3 text-xs font-semibold tracking-wide border-b-2 transition-all flex items-center space-x-2 ${
            activeSubTab === "longterm"
              ? "border-[#58a6ff] text-[#58a6ff]"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
          id="subtab-longterm"
        >
          <Brain className="w-4 h-4" />
          <span>🧠 Memori Jangka Panjang (Semantik)</span>
        </button>

        <button
          onClick={() => setActiveSubTab("workspace")}
          className={`pb-3 text-xs font-semibold tracking-wide border-b-2 transition-all flex items-center space-x-2 ${
            activeSubTab === "workspace"
              ? "border-[#58a6ff] text-[#58a6ff]"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
          id="subtab-workspace"
        >
          <Database className="w-4 h-4" />
          <span>📁 Indeks Berkas Workspace (Vektor)</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        
        {/* ==================================== */}
        {/* VIEW 1: LONG-TERM SEMANTIC MEMORIES */}
        {/* ==================================== */}
        {activeSubTab === "longterm" && (
          <div className="space-y-6" id="long-term-memories-view">
            
            {/* Informational Hero Banner */}
            <div className="flex items-start space-x-3.5 p-4 bg-[#161b22] border border-[#30363d] rounded-lg shadow-sm">
              <div className="p-2.5 bg-[#21262d] rounded-lg border border-[#30363d] text-[#58a6ff] flex-shrink-0">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-gray-200 flex items-center space-x-2">
                  <span>Memori Jangka Panjang Dinamis</span>
                  <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded uppercase font-mono font-normal">
                    Auto-Extraction Active
                  </span>
                </h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Fakta-fakta di bawah ini digunakan oleh AI lintas model (Gemini, OpenRouter, Ollama) sebagai pedoman kepribadian dan ingatan permanent tentang Anda. 
                  Sistem mengekstrak memori baru secara otomatis dari obrolan Anda, atau Anda dapat menambah/mengeditnya secara manual.
                </p>
              </div>
            </div>

            {/* Quick Search and Add Memory Segment */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              
              {/* Add Memory Form (Left/Top) */}
              <form onSubmit={handleAddMemory} className="xl:col-span-5 bg-[#161b22] border border-[#30363d] rounded-lg p-4 space-y-3 flex flex-col justify-between">
                <div>
                  <h5 className="text-xs font-semibold text-gray-300 flex items-center space-x-1.5 mb-2.5">
                    <Plus className="w-4 h-4 text-[#58a6ff]" />
                    <span>Tambah Memori Baru</span>
                  </h5>
                  
                  {/* Category Picker */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setNewCategory("user")}
                      className={`flex items-center justify-center space-x-1 p-2 rounded text-[11px] font-medium border transition-colors ${
                        newCategory === "user"
                          ? "bg-blue-500/10 border-blue-500/40 text-blue-400"
                          : "bg-[#21262d]/40 border-[#30363d] text-gray-400 hover:text-gray-300"
                      }`}
                    >
                      <User className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">Fakta User</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewCategory("ai")}
                      className={`flex items-center justify-center space-x-1 p-2 rounded text-[11px] font-medium border transition-colors ${
                        newCategory === "ai"
                          ? "bg-purple-500/10 border-purple-500/40 text-purple-400"
                          : "bg-[#21262d]/40 border-[#30363d] text-gray-400 hover:text-gray-300"
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">Fakta AI</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewCategory("knowledge")}
                      className={`flex items-center justify-center space-x-1 p-2 rounded text-[11px] font-medium border transition-colors ${
                        newCategory === "knowledge"
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                          : "bg-[#21262d]/40 border-[#30363d] text-gray-400 hover:text-gray-300"
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">Pengetahuan</span>
                    </button>
                  </div>

                  {/* Input Content */}
                  <textarea
                    placeholder={
                      newCategory === "user"
                        ? "Contoh: Pengguna lebih suka penjelasan singkat dan ramah."
                        : newCategory === "ai"
                        ? "Contoh: AI harus dipanggil 'Kimi' dan selalu bersikap humoris."
                        : "Contoh: React 19 memperkenalkan Server Actions untuk memproses data langsung di server."
                    }
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={3}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2.5 text-xs text-gray-300 focus:outline-none focus:border-[#58a6ff] placeholder-gray-500 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!newContent.trim()}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white rounded text-xs font-semibold transition-colors mt-2 shadow"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan ke Memori</span>
                </button>
              </form>

              {/* Memory Search and Status (Right/Bottom) */}
              <div className="xl:col-span-7 space-y-4 flex flex-col">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                    <Search className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    placeholder="Saring fakta memori..."
                    value={memorySearch}
                    onChange={(e) => setMemorySearch(e.target.value)}
                    className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 pl-9 text-xs text-gray-300 focus:outline-none focus:border-[#58a6ff] placeholder-gray-500 transition-colors"
                  />
                </div>

                {/* Totals Status Banner */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-[#1f242c]/50 border border-blue-500/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <User className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <span className="text-xs text-gray-400 truncate">User</span>
                    </div>
                    <span className="text-sm font-bold text-blue-400 font-mono ml-2">{userMemories.length}</span>
                  </div>
                  <div className="p-3 bg-[#1f242c]/50 border border-purple-500/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <Bot className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <span className="text-xs text-gray-400 truncate">AI (Diri)</span>
                    </div>
                    <span className="text-sm font-bold text-purple-400 font-mono ml-2">{aiMemories.length}</span>
                  </div>
                  <div className="p-3 bg-[#1f242c]/50 border border-emerald-500/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="text-xs text-gray-400 truncate">Pengetahuan</span>
                    </div>
                    <span className="text-sm font-bold text-emerald-400 font-mono ml-2">{knowledgeMemories.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Memories Lists (Split sections) */}
            <div className="space-y-4">
              
              {/* User Memories Column */}
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-blue-400 flex items-center space-x-1.5 uppercase tracking-wider px-1">
                  <User className="w-3.5 h-3.5" />
                  <span>Fakta & Preferensi Pengguna ({userMemories.length})</span>
                </h5>

                {isMemoriesLoading && longTermMemories.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-xs font-mono flex items-center justify-center space-x-2 bg-[#161b22]/30 border border-[#30363d]/50 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    <span>Memuat basis memori...</span>
                  </div>
                ) : userMemories.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-xs border border-dashed border-[#30363d] rounded-lg">
                    Belum ada fakta pengguna yang disimpan.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {userMemories.map((mem) => (
                      <div key={mem.id} className="bg-[#161b22] border border-[#30363d] hover:border-blue-500/30 rounded-lg p-3.5 transition-all flex flex-col justify-between group">
                        {editingId === mem.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-xs text-gray-300 focus:outline-none focus:border-blue-500 resize-none"
                              rows={2}
                            />
                            <div className="flex justify-end space-x-1.5">
                              <button
                                onClick={cancelEditing}
                                className="p-1 px-2 text-[10px] bg-[#21262d] hover:bg-[#30363d] text-gray-400 rounded flex items-center space-x-1 transition-colors"
                              >
                                <X className="w-3 h-3" />
                                <span>Batal</span>
                              </button>
                              <button
                                onClick={() => handleSaveEdit(mem.id)}
                                className="p-1 px-2 text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/40 rounded flex items-center space-x-1 transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                <span>Simpan</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-gray-200 leading-relaxed break-words">{mem.content}</p>
                            <div className="flex items-center justify-between border-t border-[#30363d]/50 pt-2.5 mt-2.5">
                              <span className="text-[10px] text-gray-500 font-mono">
                                Diperbarui: {new Date(mem.timestamp).toLocaleDateString("id-ID")}
                              </span>
                              <div className="flex space-x-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditing(mem)}
                                  className="p-1 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all"
                                  title="Edit memori"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteMemory(mem.id)}
                                  className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                                  title="Hapus memori"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Self Facts Column */}
              <div className="space-y-2 pt-2">
                <h5 className="text-xs font-semibold text-purple-400 flex items-center space-x-1.5 uppercase tracking-wider px-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Karakter, Aturan & Karakteristik AI ({aiMemories.length})</span>
                </h5>

                {isMemoriesLoading && longTermMemories.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-xs font-mono flex items-center justify-center space-x-2 bg-[#161b22]/30 border border-[#30363d]/50 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    <span>Memuat basis memori...</span>
                  </div>
                ) : aiMemories.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-xs border border-dashed border-[#30363d] rounded-lg">
                    Belum ada aturan AI yang disimpan.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {aiMemories.map((mem) => (
                      <div key={mem.id} className="bg-[#161b22] border border-[#30363d] hover:border-purple-500/30 rounded-lg p-3.5 transition-all flex flex-col justify-between group">
                        {editingId === mem.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-xs text-gray-300 focus:outline-none focus:border-purple-500 resize-none"
                              rows={2}
                            />
                            <div className="flex justify-end space-x-1.5">
                              <button
                                onClick={cancelEditing}
                                className="p-1 px-2 text-[10px] bg-[#21262d] hover:bg-[#30363d] text-gray-400 rounded flex items-center space-x-1 transition-colors"
                              >
                                <X className="w-3 h-3" />
                                <span>Batal</span>
                              </button>
                              <button
                                onClick={() => handleSaveEdit(mem.id)}
                                className="p-1 px-2 text-[10px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border border-purple-500/40 rounded flex items-center space-x-1 transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                <span>Simpan</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-gray-200 leading-relaxed break-words">{mem.content}</p>
                            <div className="flex items-center justify-between border-t border-[#30363d]/50 pt-2.5 mt-2.5">
                              <span className="text-[10px] text-gray-500 font-mono">
                                Diperbarui: {new Date(mem.timestamp).toLocaleDateString("id-ID")}
                              </span>
                              <div className="flex space-x-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditing(mem)}
                                  className="p-1 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 rounded transition-all"
                                  title="Edit memori"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteMemory(mem.id)}
                                  className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                                  title="Hapus memori"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Knowledge Base / Factual Column */}
              <div className="space-y-2 pt-2">
                <h5 className="text-xs font-semibold text-emerald-400 flex items-center space-x-1.5 uppercase tracking-wider px-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Basis Pengetahuan & Informasi Terindeks ({knowledgeMemories.length})</span>
                </h5>

                {isMemoriesLoading && longTermMemories.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-xs font-mono flex items-center justify-center space-x-2 bg-[#161b22]/30 border border-[#30363d]/50 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>Memuat basis memori...</span>
                  </div>
                ) : knowledgeMemories.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-xs border border-dashed border-[#30363d] rounded-lg bg-[#161b22]/10 leading-normal px-4">
                    Belum ada memori pengetahuan yang disimpan. AI akan mengekstrak fakta penting hasil pencarian web ke sini secara otomatis.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {knowledgeMemories.map((mem) => (
                      <div key={mem.id} className="bg-[#161b22] border border-[#30363d] hover:border-emerald-500/30 rounded-lg p-3.5 transition-all flex flex-col justify-between group">
                        {editingId === mem.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 resize-none"
                              rows={2}
                            />
                            <div className="flex justify-end space-x-1.5">
                              <button
                                onClick={cancelEditing}
                                className="p-1 px-2 text-[10px] bg-[#21262d] hover:bg-[#30363d] text-gray-400 rounded flex items-center space-x-1 transition-colors"
                              >
                                <X className="w-3 h-3" />
                                <span>Batal</span>
                              </button>
                              <button
                                onClick={() => handleSaveEdit(mem.id)}
                                className="p-1 px-2 text-[10px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded flex items-center space-x-1 transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                <span>Simpan</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-gray-200 leading-relaxed break-words">{mem.content}</p>
                            <div className="flex items-center justify-between border-t border-[#30363d]/50 pt-2.5 mt-2.5">
                              <span className="text-[10px] text-gray-500 font-mono">
                                Diperbarui: {new Date(mem.timestamp).toLocaleDateString("id-ID")}
                              </span>
                              <div className="flex space-x-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditing(mem)}
                                  className="p-1 text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                                  title="Edit memori"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteMemory(mem.id)}
                                  className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                                  title="Hapus memori"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* ==================================== */}
        {/* VIEW 2: WORKSPACE FILE VECTOR INDICES */}
        {/* ==================================== */}
        {activeSubTab === "workspace" && (
          <div className="space-y-4 animate-fadeIn" id="workspace-vectors-view">
            
            {/* Title block */}
            <div className="flex items-start space-x-3 p-4 bg-[#161b22] border border-[#30363d] rounded-lg shadow-sm">
              <div className="p-2 bg-[#21262d] rounded-lg border border-[#30363d] text-[#58a6ff] flex-shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-gray-200">
                  Pusat Penjelajah Memori Vektor (Chroma Ledger)
                </h4>
                <p className="text-xs text-gray-400 leading-normal">
                  Menampilkan daftar berkas di dalam workspace aktif yang telah diparsing, diindeks, dan disinkronisasikan ke memori jangka panjang AI.
                </p>
              </div>
            </div>

            {/* Toolbar / Search & Refresher */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="Cari berkas memori..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-1.5 pl-9 text-xs text-gray-300 focus:outline-none focus:border-[#58a6ff] placeholder-gray-500 transition-colors"
                />
              </div>

              <button
                onClick={fetchMemoryStatus}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-4 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-gray-200 rounded transition-colors disabled:opacity-50"
                id="memory-refresh-btn"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                <span>Segarkan</span>
              </button>
            </div>

            {/* Grid Table */}
            <div className="border border-[#30363d] rounded-lg overflow-hidden bg-[#0d1117] flex flex-col shadow-sm">
              <div className="grid grid-cols-12 px-4 py-2 bg-[#161b22] border-b border-[#30363d] text-xs font-semibold text-gray-400 font-mono">
                <span className="col-span-6">LOKASI FILE (WORKSPACE)</span>
                <span className="col-span-3">MD5 CHUNKS HASH</span>
                <span className="col-span-3 text-right">DIINDIKS PADA</span>
              </div>

              <div className="divide-y divide-[#30363d]/40 max-h-[400px] overflow-y-auto">
                {isLoading && files.length === 0 ? (
                  <div className="py-12 flex items-center justify-center text-gray-400 text-xs font-mono space-x-2">
                    <Loader2 className="w-5 h-5 animate-spin text-[#58a6ff]" />
                    <span>Menyinkronkan data ledger...</span>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-gray-500 text-xs p-6 text-center space-y-2">
                    <HardDrive className="w-10 h-10 text-gray-600" />
                    <p className="font-semibold text-gray-400">Tidak Ada Berkas Memori</p>
                    <p className="max-w-xs leading-normal">Belum ada berkas terindeks atau pencarian tidak cocok.</p>
                  </div>
                ) : (
                  filteredFiles.map((file, i) => (
                    <div key={i} className="grid grid-cols-12 px-4 py-3 hover:bg-[#161b22]/30 items-center text-xs font-mono transition-colors">
                      <span className="col-span-6 text-gray-200 truncate pr-3 flex items-center space-x-2" title={file.filename}>
                        <FileCode className="w-3.5 h-3.5 text-[#58a6ff] flex-shrink-0" />
                        <span className="truncate">{file.filename}</span>
                      </span>
                      <span className="col-span-3 text-gray-400 text-[11px] truncate font-mono select-all" title={file.hash}>
                        {file.hash}
                      </span>
                      <span className="col-span-3 text-right text-gray-500 text-[11px]">
                        {new Date(file.last_updated * 1000).toLocaleString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          year: "numeric",
                          month: "short",
                          day: "numeric"
                        })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
