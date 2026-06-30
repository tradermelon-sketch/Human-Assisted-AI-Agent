import React, { useState, useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Loader2, AlertCircle, RefreshCw, FileText } from "lucide-react";

interface DiffViewerProps {
  filePath: string;
  newValue: string;
}

export default function DiffViewer({ filePath, newValue }: DiffViewerProps) {
  const [originalValue, setOriginalValue] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchOriginal() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/file/content?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) {
          throw new Error(`Gagal memuat berkas asli (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (active) {
          if (data.status === "success") {
            setOriginalValue(data.content || "");
          } else {
            throw new Error(data.error || "Gagal membaca konten berkas");
          }
        }
      } catch (err: any) {
        if (active) {
          setError(err.message);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    fetchOriginal();

    return () => {
      active = false;
    };
  }, [filePath]);

  // Determine file language extension for Monaco Editor highlighting
  const getLanguage = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js":
      case "jsx":
        return "javascript";
      case "ts":
      case "tsx":
        return "typescript";
      case "json":
        return "json";
      case "py":
        return "python";
      case "html":
        return "html";
      case "css":
        return "css";
      case "md":
        return "markdown";
      default:
        return "plaintext";
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-lg border border-[#30363d] overflow-hidden" id="diff-viewer-root">
      {/* Header Info */}
      <div className="px-4 py-2.5 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-xs font-mono font-semibold text-gray-200 truncate max-w-md" title={filePath}>
            {filePath}
          </span>
        </div>
        <div className="flex items-center space-x-3 text-[10px] font-mono text-gray-400">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-red-500/30 border border-red-500"></span>
            <span>Asli</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500/30 border border-emerald-500"></span>
            <span>Usulan</span>
          </span>
        </div>
      </div>

      {/* Editor Space */}
      <div className="flex-1 relative min-h-[250px] bg-[#090d13]">
        {isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d13] text-gray-400 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#58a6ff]" />
            <span className="text-xs font-mono">Memuat perbandingan baris kode...</span>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#090d13] text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-rose-500" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-200">Gagal Membandingkan File</p>
              <p className="text-xs text-gray-400 max-w-sm font-mono leading-normal">{error}</p>
            </div>
            <button
              onClick={() => {
                setOriginalValue("");
                setIsLoading(true);
                setError(null);
                const event = new CustomEvent("retry-diff");
                window.dispatchEvent(event);
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-gray-200 rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Coba Lagi</span>
            </button>
          </div>
        ) : (
          <DiffEditor
            height="100%"
            language={getLanguage(filePath)}
            theme="vs-dark"
            original={originalValue}
            modified={newValue}
            options={{
              readOnly: true,
              fontSize: 12,
              fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderSideBySide: true,
              originalEditable: false,
              lineNumbers: "on",
              diffWordWrap: "on"
            }}
          />
        )}
      </div>
    </div>
  );
}
