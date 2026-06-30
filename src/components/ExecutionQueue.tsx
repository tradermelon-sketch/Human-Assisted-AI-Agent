import React, { useRef, useEffect } from "react";
import { 
  Terminal, Play, Loader2, CheckCircle, XCircle, AlertCircle, 
  Trash2, RefreshCw, X, ShieldAlert 
} from "lucide-react";
import { ExecutionStepReport } from "../types";

interface ExecutionQueueProps {
  isExecuting: boolean;
  executionSteps: ExecutionStepReport[];
  executionLogs: string[];
  executionSuccess: boolean | null;
  onReset: () => void;
  executionId?: string | null;
  rollbackExecution?: () => Promise<void>;
  isRollingBack?: boolean;
  rollbackSuccess?: boolean | null;
}

export default function ExecutionQueue({
  isExecuting,
  executionSteps,
  executionLogs,
  executionSuccess,
  onReset,
  executionId,
  rollbackExecution,
  isRollingBack,
  rollbackSuccess
}: ExecutionQueueProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll console logs window to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [executionLogs]);

  return (
    <div className="flex flex-col h-full p-6 space-y-4 overflow-hidden" id="execution-queue-root">
      
      {/* Execution Status Header Panel */}
      <div className="flex items-center justify-between p-4 bg-[#161b22] border border-[#30363d] rounded-lg">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            {isExecuting ? (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30">
                <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
              </div>
            ) : executionSuccess === true ? (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                <CheckCircle className="w-5 h-5 text-[#2ea043]" />
              </div>
            ) : executionSuccess === false ? (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-rose-500/10 border border-rose-500/30">
                <XCircle className="w-5 h-5 text-[#f85149]" />
              </div>
            ) : (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-500/10 border border-gray-500/30">
                <Terminal className="w-4 h-4 text-gray-400" />
              </div>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-200">
              {isExecuting 
                ? "Prosedur Eksekusi Sedang Berjalan..." 
                : executionSuccess === true 
                  ? "Eksekusi Selesai dengan Sukses!" 
                  : executionSuccess === false 
                    ? "Eksekusi Gagal!" 
                    : "Menunggu Instruksi Eksekusi"}
            </h4>
            <p className="text-xs text-gray-400 font-mono">
              Koneksi: {isExecuting ? "WS ONLINE" : "STANDBY"} &bull; Real-time output feedback streaming
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {executionId && executionSuccess === true && rollbackExecution && (
            <button
              onClick={rollbackExecution}
              disabled={isRollingBack || rollbackSuccess === true}
              className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                rollbackSuccess === true
                  ? "bg-[#1c2c20] text-emerald-400 border border-[#2ea043]/30 cursor-not-allowed font-mono"
                  : isRollingBack
                    ? "bg-amber-600/20 text-amber-500 border border-amber-500/30 cursor-wait animate-pulse"
                    : "bg-amber-600 hover:bg-amber-700 text-white shadow"
              }`}
              title="Pulihkan semua berkas yang diubah oleh manifest ini kembali ke versi sebelumnya"
              id="rollback-execution-btn"
            >
              {isRollingBack ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : rollbackSuccess === true ? (
                <CheckCircle className="w-3.5 h-3.5" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>
                {isRollingBack 
                  ? "Memulihkan..." 
                  : rollbackSuccess === true 
                    ? "Telah Dipulihkan" 
                    : "Batalkan Perubahan (Undo)"}
              </span>
            </button>
          )}

          {/* Action Button to close/abort queue */}
          <button
            onClick={onReset}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-gray-300 rounded transition-colors"
            title="Reset & Bersihkan Antrean"
            id="reset-queue-btn"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Real-time Stepper Progress Panel */}
      {executionSteps.length > 0 && (
        <div className="border border-[#30363d] rounded-lg bg-[#0d1117] overflow-hidden" id="execution-stepper">
          <div className="px-3 py-2 bg-[#161b22] border-b border-[#30363d] text-xs font-semibold text-gray-300 flex items-center justify-between">
            <span>URUTAN ALUR STEPPER MANIFEST</span>
            <span className="text-[10px] font-mono text-gray-400">
              {executionSteps.filter(s => s.status === "success").length} / {executionSteps.length} Sukses
            </span>
          </div>
          <div className="divide-y divide-[#30363d]/50 max-h-[160px] overflow-y-auto">
            {executionSteps.map((step, idx) => {
              let statusColor = "text-gray-500";
              let statusText = "Ready";
              let statusBg = "bg-gray-500/10";
              let icon = <div className="w-2 h-2 rounded-full bg-gray-600"></div>;
              
              if (step.status === "running") {
                statusColor = "text-[#e1b434]";
                statusText = "Running";
                statusBg = "bg-[#e1b434]/10";
                icon = <Loader2 className="w-3 h-3 text-[#e1b434] animate-spin" />;
              } else if (step.status === "success") {
                statusColor = "text-[#2ea043]";
                statusText = "Success";
                statusBg = "bg-[#2ea043]/10";
                icon = <CheckCircle className="w-3.5 h-3.5 text-[#2ea043]" />;
              } else if (step.status === "failed") {
                statusColor = "text-[#f85149]";
                statusText = "Failed";
                statusBg = "bg-[#f85149]/10";
                icon = <XCircle className="w-3.5 h-3.5 text-[#f85149]" />;
              } else if (step.status === "aborted") {
                statusColor = "text-gray-600";
                statusText = "Aborted";
                statusBg = "bg-gray-800/20";
                icon = <ShieldAlert className="w-3.5 h-3.5 text-gray-600" />;
              }

              return (
                <div key={idx} className="flex items-center justify-between p-3 text-xs font-mono bg-[#0d1117] hover:bg-[#161b22]/20 transition-all">
                  <div className="flex items-center space-x-3 min-w-0">
                    <span className="text-gray-500 select-none">#{step.index + 1}</span>
                    <span className="font-bold uppercase tracking-wider text-[10px] bg-[#161b22] px-1.5 py-0.5 rounded border border-[#30363d] text-gray-300">
                      {step.type.replace("_file", "")}
                    </span>
                    <span className="text-gray-300 truncate font-semibold" title={step.path}>
                      {step.path}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {step.error && (
                      <span className="text-[10px] text-red-400 max-w-[150px] truncate" title={step.error}>
                        {step.error}
                      </span>
                    )}
                    <span className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-bold ${statusColor} ${statusBg}`}>
                      {icon}
                      <span>{statusText}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Terminal Live logs Panel */}
      <div className="flex-1 flex flex-col border border-[#30363d] rounded-lg overflow-hidden bg-[#06090f]" id="terminal-live-logs">
        <div className="px-3 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs font-mono">
          <span className="text-gray-300 font-semibold">TERMINAL LOG OUTPUT</span>
          {isExecuting ? (
            <span className="text-emerald-500 text-[10px] animate-pulse font-bold flex items-center space-x-1">
              <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full"></span>
              <span>WS STREAMING</span>
            </span>
          ) : (
            <span className="text-gray-500 text-[10px]">STANDBY</span>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-gray-300 space-y-2 selection:bg-gray-700">
          {executionLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center text-xs">
              <Terminal className="w-8 h-8 mb-2 text-gray-600" />
              Belum ada riwayat pengerjaan di tab ini. Jalankan eksekusi dari Tab Manifest.
            </div>
          ) : (
            executionLogs.map((log, i) => {
              let logColor = "text-gray-300";
              if (log.includes("[ERROR]") || log.includes("[FAILED]")) {
                logColor = "text-red-400";
              } else if (log.includes("[SUCCESS]")) {
                logColor = "text-emerald-400";
              } else if (log.includes("[SYSTEM]") || log.includes("[START]")) {
                logColor = "text-sky-400";
              } else if (log.includes("[ABORTED]")) {
                logColor = "text-amber-500";
              }
              return (
                <div key={i} className={`whitespace-pre-wrap ${logColor}`}>
                  {log}
                </div>
              );
            })
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
