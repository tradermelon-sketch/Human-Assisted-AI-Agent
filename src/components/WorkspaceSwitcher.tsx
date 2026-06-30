import React, { useState, useEffect } from "react";
import { 
  Folder, FolderOpen, ChevronRight, X, Clock, MapPin, 
  ArrowLeft, Check, Loader2, AlertCircle, Home
} from "lucide-react";
import { motion } from "motion/react";

interface DirectoryItem {
  name: string;
  path: string;
}

interface RecentWorkspace {
  path: string;
  timestamp: number;
}

interface WorkspaceSwitcherProps {
  currentRoot: string;
  onClose: () => void;
  onWorkspaceChanged: (newPath: string) => void;
}

export default function WorkspaceSwitcher({ currentRoot, onClose, onWorkspaceChanged }: WorkspaceSwitcherProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryItem[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSetting, setIsSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Initialize by browsing the active workspace root or fallback empty (allowed bases list)
  useEffect(() => {
    browseFolder(currentRoot);
    fetchRecentWorkspaces();
  }, [currentRoot]);

  // Browse folder directories
  const browseFolder = async (pathStr: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const url = pathStr 
        ? `/api/workspace/browse?path=${encodeURIComponent(pathStr)}`
        : "/api/workspace/browse";
      const res = await fetch(url);
      const data = await res.json();
      
      if (res.ok && data.status === "success") {
        setCurrentPath(data.current_path || "");
        setParentPath(data.parent_path);
        setDirectories(data.directories || []);
      } else {
        setError(data.error || "Gagal membuka folder.");
      }
    } catch (err: any) {
      setError(`Kesalahan jaringan: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch recent workspaces list
  const fetchRecentWorkspaces = async () => {
    try {
      const res = await fetch("/api/workspace/recent");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.recent_workspaces)) {
          setRecentWorkspaces(data.recent_workspaces);
        }
      }
    } catch (e) {
      console.error("Failed to load recent workspaces", e);
    }
  };

  // Set the workspace root actively
  const selectWorkspace = async (pathStr: string) => {
    if (!pathStr) return;
    setIsSetting(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/set", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathStr })
      });
      const data = await res.json();
      
      if (res.ok && data.status === "success") {
        setSuccessMsg("Workspace berhasil diganti secara dinamis!");
        onWorkspaceChanged(data.workspace_root);
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setError(data.error || "Gagal menetapkan workspace baru.");
      }
    } catch (err: any) {
      setError(`Gagal menyimpan workspace: ${err.message}`);
    } finally {
      setIsSetting(false);
    }
  };

  // Breadcrumbs path parser
  const getCrumbs = () => {
    if (!currentPath) return [];
    const isAbs = currentPath.startsWith("/") || currentPath.startsWith("\\");
    const parts = currentPath.split(/[\\\/]/).filter(Boolean);
    
    const crumbs = [];
    let accum = "";
    
    for (let i = 0; i < parts.length; i++) {
      if (isAbs && i === 0) {
        accum = "/" + parts[i];
      } else {
        accum = accum ? `${accum}/${parts[i]}` : parts[i];
      }
      crumbs.push({
        name: parts[i],
        path: accum
      });
    }
    return crumbs;
  };

  return (
    <div 
      className="absolute inset-0 bg-[#000000]/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      id="workspace-switcher-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-xl bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] font-sans"
        id="workspace-switcher-modal"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d] bg-[#1f242c]">
          <div className="flex items-center space-x-2.5">
            <FolderOpen className="w-5 h-5 text-[#58a6ff]" />
            <div>
              <h3 className="text-sm font-semibold text-gray-100">Pilih Folder Proyek Aktif</h3>
              <p className="text-[11px] text-gray-400">Ganti workspace root agen secara aman di sandbox</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-100 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
            id="btn-close-switcher"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-4 flex flex-col min-h-0">
          
          {/* Recent Workspaces section */}
          {recentWorkspaces.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>WORKSPACE TERBARU</span>
              </span>
              <div className="grid grid-cols-1 gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                {recentWorkspaces.map((ws, i) => (
                  <button
                    key={i}
                    onClick={() => browseFolder(ws.path)}
                    className={`flex items-center justify-between p-2 rounded text-left transition-all group border text-xs font-mono truncate ${
                      ws.path === currentRoot
                        ? "bg-[#1f242c] border-[#58a6ff]/50 text-[#58a6ff]"
                        : "bg-[#0d1117] border-[#30363d]/50 text-gray-300 hover:border-[#444c56] hover:bg-[#161b22]"
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                      <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${ws.path === currentRoot ? "text-[#58a6ff]" : "text-gray-500"}`} />
                      <span className="truncate pr-4" title={ws.path}>{ws.path}</span>
                    </div>
                    {ws.path === currentRoot && (
                      <span className="text-[9px] font-sans font-semibold bg-[#58a6ff]/20 text-[#58a6ff] px-1.5 py-0.5 rounded">
                        Aktif
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Directory Explorer section */}
          <div className="flex-1 flex flex-col min-h-0 border border-[#30363d] rounded-lg bg-[#0d1117] overflow-hidden">
            
            {/* Breadcrumb Bar */}
            <div className="flex items-center px-3 py-2 bg-[#161b22] border-b border-[#30363d] overflow-x-auto whitespace-nowrap scrollbar-none text-xs text-gray-300 font-mono">
              <button 
                onClick={() => browseFolder("")}
                className="flex items-center space-x-1 p-1 rounded hover:bg-[#21262d] text-[#58a6ff]"
                title="Bases Root"
              >
                <Home className="w-3.5 h-3.5" />
              </button>
              
              {getCrumbs().map((crumb, idx) => (
                <div key={idx} className="flex items-center">
                  <ChevronRight className="w-3 h-3 mx-1 text-gray-500" />
                  <button
                    onClick={() => browseFolder(crumb.path)}
                    className={`px-1 py-0.5 rounded hover:bg-[#21262d] ${
                      idx === getCrumbs().length - 1 ? "text-gray-100 font-bold" : "text-gray-400"
                    }`}
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Subfolders Listing */}
            <div className="flex-1 overflow-y-auto p-2 divide-y divide-[#30363d]/30 min-h-[160px]">
              {isLoading ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 text-xs py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#58a6ff] mb-2" />
                  <span>Memindai direktori...</span>
                </div>
              ) : directories.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 text-xs py-8 text-center px-4 space-y-1">
                  <FolderOpen className="w-8 h-8 text-gray-600 mb-1" />
                  <span className="font-semibold text-gray-400">Tidak ada subfolder</span>
                  <p className="text-[11px] text-gray-500 max-w-xs leading-normal">
                    Folder ini tidak memiliki subdirektori lagi atau dibatasi oleh sandbox.
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {parentPath !== undefined && (
                    <button
                      onClick={() => browseFolder(parentPath || "")}
                      className="w-full flex items-center space-x-2.5 p-2 rounded hover:bg-[#161b22]/50 text-left text-xs font-mono text-[#58a6ff] group"
                    >
                      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                      <span>.. (Kembali ke folder atas)</span>
                    </button>
                  )}
                  
                  {directories.map((dir, idx) => (
                    <button
                      key={idx}
                      onClick={() => browseFolder(dir.path)}
                      className="w-full flex items-center justify-between p-2 rounded hover:bg-[#161b22]/50 text-left text-xs font-mono text-gray-300 group"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <Folder className="w-4 h-4 text-[#e1b434] group-hover:text-yellow-400 flex-shrink-0" />
                        <span className="truncate">{dir.name}</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="p-3 bg-red-950/40 border border-red-900/40 rounded-lg text-xs text-red-400 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-900/40 rounded-lg text-xs text-emerald-400 flex items-start space-x-2 animate-pulse">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-4 border-t border-[#30363d] bg-[#1f242c] flex items-center justify-between">
          <div className="min-w-0 pr-4">
            <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider">LOKASI PILIHAN</span>
            <span className="block text-xs font-mono text-gray-200 truncate mt-0.5" title={currentPath}>
              {currentPath || "[Daftar folder dasar]"}
            </span>
          </div>
          
          <button
            onClick={() => selectWorkspace(currentPath)}
            disabled={!currentPath || isSetting || currentPath === currentRoot}
            className={`flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all flex-shrink-0 ${
              !currentPath || currentPath === currentRoot
                ? "bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]"
                : "bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-900/10 cursor-pointer"
            }`}
            id="btn-confirm-switcher"
          >
            {isSetting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Gunakan folder ini</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
