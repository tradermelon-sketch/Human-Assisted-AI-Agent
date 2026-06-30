import React, { useState, useEffect } from "react";
import { 
  RotateCcw, Trash2, Calendar, FileCode, CheckCircle2, AlertTriangle, 
  RefreshCw, Layers, Check, Clock, Loader2
} from "lucide-react";
import { motion } from "motion/react";

interface BackupFile {
  path: string;
  action: "created" | "modified";
}

interface BackupItem {
  executionId: string;
  timestamp: number;
  files: BackupFile[];
}

interface BackupExplorerProps {
  onRollbackTriggered?: () => void;
}

export default function BackupExplorer({ onRollbackTriggered }: BackupExplorerProps) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"rollback" | "commit" | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchBackups = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/manifest/backups");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.backups)) {
          setBackups(data.backups);
        } else {
          setError(data.error || "Gagal mengambil daftar backup.");
        }
      } else {
        setError("Gagal menghubungi server.");
      }
    } catch (err: any) {
      setError(`Kesalahan jaringan: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleRollback = async (executionId: string) => {
    if (actioningId) return;
    setActioningId(executionId);
    setActionType("rollback");
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/manifest/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId })
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setSuccessMsg(`Berhasil memulihkan ${data.rolled_back?.length || 0} file!`);
        // Refresh backups list
        await fetchBackups();
        if (onRollbackTriggered) {
          onRollbackTriggered();
        }
        // Dispatch global workspace update
        window.dispatchEvent(new CustomEvent("workspace-updated"));
      } else {
        setError(data.error || "Gagal memulihkan cadangan.");
      }
    } catch (err: any) {
      setError(`Gagal melakukan rollback: ${err.message}`);
    } finally {
      setActioningId(null);
      setActionType(null);
    }
  };

  const handleCommit = async (executionId: string) => {
    if (actioningId) return;
    setActioningId(executionId);
    setActionType("commit");
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/manifest/backups/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId })
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setSuccessMsg("Snapshot backup berhasil dihapus / didecommit.");
        await fetchBackups();
      } else {
        setError(data.error || "Gagal mendiscard cadangan.");
      }
    } catch (err: any) {
      setError(`Gagal melakukan commit: ${err.message}`);
    } finally {
      setActioningId(null);
      setActionType(null);
    }
  };

  const formatTimestamp = (ts: number) => {
    try {
      const date = new Date(ts);
      return date.toLocaleString("id-ID", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (e) {
      return `exec_${ts}`;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-200" id="backup-explorer-root">
      {/* Action Header Panel */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#161b22] border-b border-[#30363d]">
        <div>
          <h2 className="text-sm font-semibold text-gray-100 flex items-center space-x-2">
            <RotateCcw className="w-4 h-4 text-[#58a6ff]" />
            <span>Katalog Snapshot & Rollback Berkas</span>
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Daftar otomatis snapshot cadangan file yang dapat Anda kembalikan ke kondisi semula sebelum eksekusi manifest.
          </p>
        </div>
        <button
          onClick={fetchBackups}
          disabled={isLoading}
          className="flex items-center space-x-1 px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-gray-300 rounded transition-colors disabled:opacity-50"
          id="refresh-backups-btn"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Alerts and messages banner */}
      {(error || successMsg) && (
        <div className="px-6 py-2 border-b border-[#30363d] bg-[#161b22]/50 flex flex-col space-y-1.5">
          {error && (
            <div className="flex items-center space-x-2 text-xs text-red-400" id="backup-error-banner">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="flex items-center space-x-2 text-xs text-emerald-400" id="backup-success-banner">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6" id="backup-list-container">
        {isLoading && backups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center space-y-2">
            <Loader2 className="w-8 h-8 text-[#58a6ff] animate-spin" />
            <p className="text-xs text-gray-400 font-mono">Memuat snapshot berkas dari sandbox...</p>
          </div>
        ) : backups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-[#090d13] rounded-xl border border-[#30363d]/50">
            <div className="p-4 bg-[#161b22] rounded-full border border-[#30363d] mb-4">
              <Layers className="w-10 h-10 text-gray-500" />
            </div>
            <h3 className="text-sm font-semibold text-gray-300">Belum Ada Snapshot Cadangan</h3>
            <p className="text-xs text-gray-400 mt-1.5 max-w-sm leading-relaxed">
              Setelah Anda sukses mengeksekusi manifest yang melakukan penulisan berkas baru atau perubahan kode, sistem akan merekam snapshot otomatis di sini untuk dipulihkan jika sewaktu-waktu terjadi kegagalan.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {backups.map((item) => {
              const isProcessingThis = actioningId === item.executionId;
              
              return (
                <div 
                  key={item.executionId}
                  className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-md hover:border-[#30363d]/80 transition-all"
                  id={`backup-card-${item.executionId}`}
                >
                  {/* Card Header */}
                  <div className="px-4 py-3 bg-[#1f242c] border-b border-[#30363d] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-amber-500" />
                      <div>
                        <span className="text-xs font-semibold text-gray-200 block">
                          Snapshot {item.executionId}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {formatTimestamp(item.timestamp)}
                        </span>
                      </div>
                    </div>
                    
                    {/* Action Controls */}
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleRollback(item.executionId)}
                        disabled={!!actioningId}
                        className="flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md shadow-sm transition-colors disabled:opacity-40"
                        title="Kembalikan file-file ini ke versi semula"
                        id={`btn-rollback-${item.executionId}`}
                      >
                        {isProcessingThis && actionType === "rollback" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        <span>{isProcessingThis && actionType === "rollback" ? "Memulihkan..." : "Rollback (Undo)"}</span>
                      </button>

                      <button
                        onClick={() => handleCommit(item.executionId)}
                        disabled={!!actioningId}
                        className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-semibold bg-[#21262d] hover:bg-[#b04040]/10 hover:text-red-400 hover:border-red-500/30 border border-[#30363d] text-gray-400 rounded-md transition-colors disabled:opacity-40"
                        title="Hapus cadangan snapshot ini dari memori (Commit permanen)"
                        id={`btn-commit-${item.executionId}`}
                      >
                        {isProcessingThis && actionType === "commit" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        <span>Commit</span>
                      </button>
                    </div>
                  </div>

                  {/* Card Body - Files list */}
                  <div className="p-4 space-y-2 bg-[#0d1117]/30">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold font-mono">
                      Berkas yang Terpilih:
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {item.files.map((file, fIdx) => (
                        <div 
                          key={fIdx}
                          className="flex items-center justify-between p-2 bg-[#161b22]/50 border border-[#30363d]/50 rounded-lg text-xs"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <FileCode className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <span className="font-mono text-gray-300 truncate" title={file.path}>
                              {file.path}
                            </span>
                          </div>
                          <span className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border ${
                            file.action === "created" 
                              ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/20" 
                              : "bg-blue-950/40 text-blue-400 border-blue-500/20"
                          }`}>
                            {file.action === "created" ? "Dibuat" : "Diubah"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
