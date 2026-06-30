import { useState, useCallback, useRef } from "react";
import { Action, ExecutionStepReport } from "../types";

export interface UseExecutionSocketReturn {
  isExecuting: boolean;
  executionSteps: ExecutionStepReport[];
  executionLogs: string[];
  executionSuccess: boolean | null;
  executeManifest: (actions: Action[], history: any[], provider: string, model: string) => void;
  resetExecution: () => void;
  executionId: string | null;
  rollbackExecution: () => Promise<void>;
  isRollingBack: boolean;
  rollbackSuccess: boolean | null;
}

export function useExecutionSocket(options?: {
  onExecutionCompleted?: (success: boolean, aiResponse?: string, actualModel?: string) => void;
}): UseExecutionSocketReturn {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepReport[]>([]);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [executionSuccess, setExecutionSuccess] = useState<boolean | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackSuccess, setRollbackSuccess] = useState<boolean | null>(null);
  
  const socketRef = useRef<WebSocket | null>(null);

  const appendLog = useCallback((text: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setExecutionLogs(prev => [...prev, `[${timestamp}] ${text}`]);
  }, []);

  const resetExecution = useCallback(() => {
    setIsExecuting(false);
    setExecutionSteps([]);
    setExecutionLogs([]);
    setExecutionSuccess(null);
    setExecutionId(null);
    setRollbackSuccess(null);
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const rollbackExecution = useCallback(async () => {
    if (!executionId) return;
    setIsRollingBack(true);
    setRollbackSuccess(null);
    appendLog(`[SYSTEM] Memulai proses pemulihan (rollback) untuk ID: ${executionId}...`);

    try {
      const res = await fetch("/api/manifest/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId })
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        appendLog(`[SUCCESS] Pemulihan berhasil! Berkas-berkas dikembalikan ke keadaan semula:`);
        if (Array.isArray(data.rolled_back)) {
          data.rolled_back.forEach((item: any) => {
            appendLog(`  - [${item.action.toUpperCase()}] ${item.path}`);
          });
        }
        setRollbackSuccess(true);
        // Dispatch event to update the workspace
        window.dispatchEvent(new CustomEvent("workspace-updated"));
      } else {
        throw new Error(data.error || "Gagal melakukan pemulihan");
      }
    } catch (err: any) {
      appendLog(`[ERROR] Gagal melakukan pemulihan: ${err.message}`);
      setRollbackSuccess(false);
    } finally {
      setIsRollingBack(false);
    }
  }, [executionId, appendLog]);

  const executeManifest = useCallback((actions: Action[], history: any[], provider: string, model: string) => {
    resetExecution();
    setIsExecuting(true);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/execution`;
    
    appendLog(`[SYSTEM] Menghubungkan ke saluran eksekusi WebSocket: ${wsUrl}...`);
    
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      appendLog("[SYSTEM] Saluran aman terhubung. Mengirimkan muatan manifest...");
      socket.send(JSON.stringify({ actions, history, provider, model }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.event) {
          case "error":
            appendLog(`[ERROR] Terjadi kesalahan: ${data.message}`);
            setExecutionSuccess(false);
            setIsExecuting(false);
            break;

          case "preflight_failed":
            appendLog(`[ABORTED] Pre-flight verifikasi gagal. Eksekusi dibatalkan.`);
            if (Array.isArray(data.errors)) {
              data.errors.forEach((e: any) => {
                appendLog(`  - Indeks Aksi #${e.index}: ${e.error}`);
              });
            }
            setExecutionSuccess(false);
            setIsExecuting(false);
            break;

          case "started":
            appendLog(`[START] Memulai eksekusi ${data.total_actions} aksi berurutan...`);
            if (data.executionId) setExecutionId(data.executionId);
            setExecutionSteps(
              actions.map((act, idx) => ({
                index: idx,
                type: act.type,
                path: act.path,
                status: "pending" as const,
                error: "",
                result: null
              }))
            );
            break;

          case "step_update":
            setExecutionSteps(prev => 
              prev.map((step, idx) => {
                if (idx === data.index) {
                  return {
                    ...step,
                    status: data.status,
                    error: data.error || "",
                    result: data.result || null
                  };
                }
                return step;
              })
            );

            const stepAction = actions[data.index];
            if (stepAction) {
              const upperType = stepAction.type.toUpperCase();
              if (data.status === "running") {
                appendLog(`[${upperType}] Memproses: ${stepAction.path}...`);
              } else if (data.status === "success") {
                appendLog(`[SUCCESS] Selesai: ${stepAction.path} berhasil dieksekusi.`);
              } else if (data.status === "failed") {
                appendLog(`[FAILED] Gagal pada berkas ${stepAction.path}: ${data.error}`);
              } else if (data.status === "aborted") {
                appendLog(`[ABORTED] Aksi ditangguhkan karena kegagalan pada langkah sebelumnya.`);
              }
            }
            break;

          case "completed":
            const statusLabel = data.success ? "SUKSES" : "GAGAL";
            appendLog(`[COMPLETED] Alur eksekusi manifest selesai dengan status: ${statusLabel}.`);
            if (data.executionId) setExecutionId(data.executionId);
            setExecutionSuccess(data.success);
            setIsExecuting(false);
            if (options?.onExecutionCompleted) {
              options.onExecutionCompleted(data.success, data.ai_response, data.actual_model);
            }
            break;

          default:
            break;
        }
      } catch (err: any) {
        appendLog(`[ERROR] Gagal memparsing respons WebSocket: ${err.message}`);
      }
    };

    socket.onerror = () => {
      appendLog(`[ERROR] Kegagalan koneksi WebSocket: Gagal melakukan jabat tangan dengan server backend.`);
      setExecutionSuccess(false);
      setIsExecuting(false);
    };

    socket.onclose = () => {
      appendLog("[SYSTEM] Koneksi WebSocket ditutup.");
    };
  }, [appendLog, resetExecution]);

  return {
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
  };
}
