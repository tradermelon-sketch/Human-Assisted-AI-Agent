import React, { useState, useEffect } from "react";
import { 
  Layers, ChevronRight, X, AlertTriangle, CheckCircle2, 
  Loader2, ShieldCheck, Play, Info, Eye, Code, FileText, FolderOpen 
} from "lucide-react";
import { ActionManifest, ValidationResult, Action } from "../types";
import DiffViewer from "./DiffViewer";

interface ManifestTableProps {
  manifest: ActionManifest;
  messageId: string;
  onClose: () => void;
  onExecute: (actions: Action[]) => void;
  isExecuting: boolean;
}

export default function ManifestTable({
  manifest,
  messageId,
  onClose,
  onExecute,
  isExecuting
}: ManifestTableProps) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<ValidationResult[] | null>(null);
  const [validationSummary, setValidationSummary] = useState<{ valid: boolean; msg: string } | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(manifest.actions.length > 0 ? 0 : null);

  // Validate the manifest on load/change
  useEffect(() => {
    let active = true;
    const runValidation = async () => {
      setIsValidating(true);
      setValidationResults(null);
      setValidationSummary(null);

      try {
        const res = await fetch("/api/manifest/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: manifest.actions })
        });
        
        if (!active) return;

        if (res.ok) {
          const data = await res.json();
          setValidationResults(data.results);
          setValidationSummary({
            valid: data.valid,
            msg: data.valid 
              ? "Verifikasi Sukses: Manifest memenuhi semua aturan keselamatan sandbox." 
              : "Verifikasi Gagal: Terdapat tindakan yang dilarang atau path traversal di luar batas workspace."
          });
        } else {
          throw new Error("Gagal memperoleh respons validasi dari server.");
        }
      } catch (err: any) {
        if (!active) return;
        setValidationSummary({
          valid: false,
          msg: `Kesalahan Verifikasi: ${err.message}`
        });
      } finally {
        if (active) setIsValidating(false);
      }
    };

    runValidation();
    return () => {
      active = false;
    };
  }, [manifest]);

  const isAllValid = validationSummary?.valid ?? false;

  return (
    <div className="flex flex-col h-full bg-[#0d1117] p-6 space-y-4 overflow-y-auto" id="manifest-table-root">
      {/* Manifest Meta Panel Header */}
      <div className="flex items-center justify-between p-4 bg-[#161b22] border border-[#30363d] rounded-lg">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono font-bold text-[#e1b434] uppercase bg-[#342e1c] border border-[#e1b434]/30 px-2 py-0.5 rounded">
              Review Terbuka
            </span>
            <span className="text-sm font-semibold text-gray-200">
              Aksi Proposisi Agen
            </span>
          </div>
          <p className="text-xs text-gray-400 font-mono">
            ID Pesan: {messageId} &bull; Terdiri dari {manifest.actions.length} perubahan terverifikasi
          </p>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 hover:bg-[#30363d] text-gray-400 hover:text-gray-200 rounded transition-colors"
          title="Tutup review"
          id="close-manifest-review-btn"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Security Preflight Banner */}
      <div className={`p-4 rounded-lg border flex items-start space-x-3 transition-all ${
        isValidating 
          ? "bg-[#1c2128] border-[#30363d] text-gray-300"
          : isAllValid
            ? "bg-[#1c2c20] border-[#2ea043]/30 text-emerald-400"
            : validationSummary
              ? "bg-[#341d1a] border-[#f85149]/30 text-rose-400"
              : "bg-[#1c2128] border-[#30363d]"
      }`} id="preflight-banner">
        <div className="mt-0.5 flex-shrink-0">
          {isValidating ? (
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
          ) : isAllValid ? (
            <ShieldCheck className="w-5 h-5 text-[#2ea043]" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-[#f85149]" />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider font-mono">
            {isValidating ? "VERIFIKASI KEAMANAN SEDANG BERJALAN" : "VERIFIKASI KEAMANAN PRE-FLIGHT"}
          </p>
          <p className="text-xs text-gray-300 leading-normal">
            {isValidating 
              ? "Memeriksa manifest dari path traversal dan validitas whitelist instruksi..." 
              : validationSummary?.msg || "Belum dievaluasi. Menunggu validasi manifest..."}
          </p>
        </div>
      </div>

      {/* Grid: Actions checklist and code preview */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 h-[420px] min-h-[350px] overflow-hidden">
        {/* Left: Action list / table representation */}
        <div className="lg:col-span-5 flex flex-col border border-[#30363d] rounded-lg overflow-hidden bg-[#0d1117]" id="action-checklist-column">
          <div className="px-3 py-2 bg-[#161b22] border-b border-[#30363d] text-xs font-semibold text-gray-300">
            DAFTAR INSTALASI & MODIFIKASI
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[#30363d]/50">
            {manifest.actions.map((act, idx) => {
              const isSelected = expandedIndex === idx;
              const isVal = validationResults?.[idx];
              
              let actColor = "text-[#58a6ff]";
              let actBg = "bg-[#58a6ff]/10";
              let icon = <FileText className="w-3.5 h-3.5" />;
              
              if (act.type === "write_file") {
                actColor = "text-[#3fb950]";
                actBg = "bg-[#3fb950]/10";
                icon = <Code className="w-3.5 h-3.5" />;
              } else if (act.type === "scan_directory") {
                actColor = "text-[#d29922]";
                actBg = "bg-[#d29922]/10";
                icon = <FolderOpen className="w-3.5 h-3.5" />;
              }

              return (
                <button
                  key={idx}
                  onClick={() => setExpandedIndex(idx)}
                  className={`w-full text-left p-3 flex items-center justify-between transition-colors text-xs ${
                    isSelected 
                      ? "bg-[#21262d]" 
                      : "hover:bg-[#161b22]/50"
                  }`}
                  id={`action-item-${idx}`}
                >
                  <div className="flex items-center space-x-2.5 overflow-hidden">
                    <span className={`p-1 rounded ${actColor} ${actBg}`}>
                      {icon}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="font-mono text-gray-200 truncate" title={act.path}>
                        {act.path}
                      </span>
                      <span className="text-[10px] text-gray-400 capitalize font-sans">
                        Type: {act.type.replace("_", " ")}
                      </span>
                      {act.type === "write_file" && isVal && (
                        isVal.syntax_error ? (
                          <span className="inline-block self-start mt-1 text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-500/20">
                            Sintaks Error
                          </span>
                        ) : (
                          <span className="inline-block self-start mt-1 text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                            Sintaks OK
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-1 flex-shrink-0">
                    {isVal ? (
                      isVal.valid ? (
                        <span title="Aman & Valid">
                          <CheckCircle2 className="w-4 h-4 text-[#2ea043]" />
                        </span>
                      ) : (
                        <span title={isVal.error}>
                          <AlertTriangle className="w-4 h-4 text-[#f85149]" />
                        </span>
                      )
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Code Viewer / Editor */}
        <div className="lg:col-span-7 flex flex-col border border-[#30363d] rounded-lg overflow-hidden bg-[#090d13]" id="code-viewer-column">
          {expandedIndex !== null && manifest.actions[expandedIndex] ? (
            (() => {
              const selectedAct = manifest.actions[expandedIndex];
              return (
                <>
                  <div className="px-3 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-300 truncate font-semibold" title={selectedAct.path}>
                      {selectedAct.path}
                    </span>
                    <span className="text-gray-400">Payload Preview</span>
                  </div>
                  {expandedIndex !== null && validationResults?.[expandedIndex]?.syntax_error && (
                    <div className="px-3 py-2 bg-red-950/40 border-b border-red-900/40 text-xs text-red-400 flex items-start space-x-2 animate-fade-in" id="syntax-error-banner">
                      <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-bold">Kesalahan Sintaks Terdeteksi:</span>{" "}
                        <span className="font-mono text-gray-200">{validationResults[expandedIndex].syntax_error?.message}</span>
                        {validationResults[expandedIndex].syntax_error?.line && (
                          <span className="block text-[10px] text-red-400 font-mono mt-0.5">
                            Lokasi: Baris {validationResults[expandedIndex].syntax_error?.line}
                            {validationResults[expandedIndex].syntax_error?.column ? `, Kolom ${validationResults[expandedIndex].syntax_error?.column}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden flex flex-col bg-[#06090f] text-gray-300">
                    {selectedAct.type === "write_file" && selectedAct.content !== undefined ? (
                      <div className="flex-1 overflow-hidden p-1">
                        <DiffViewer filePath={selectedAct.path} newValue={selectedAct.content} />
                      </div>
                    ) : selectedAct.content ? (
                      <div className="flex-1 overflow-auto p-3 text-xs font-mono leading-relaxed">
                        <pre className="whitespace-pre overflow-x-auto text-[11px] font-mono leading-relaxed select-text">
                          {selectedAct.content.split("\n").map((line, i) => (
                            <div key={i} className="table-row">
                              <span className="table-cell text-right pr-3 select-none text-gray-600 border-r border-[#30363d]/50 w-8">{i + 1}</span>
                              <span className="table-cell pl-3 text-gray-300">{line}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-gray-500 space-y-1.5">
                        <Info className="w-5 h-5 text-gray-500" />
                        <span className="font-mono text-[11px]">Operasi ini tidak memiliki payload teks.</span>
                        <span className="text-[11px] max-w-xs leading-normal">Hanya membaca (read) atau menscan direktori.</span>
                      </div>
                    )}
                  </div>
                </>
              );
            })()
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-xs font-mono">
              Pilih aksi di sebelah kiri untuk melihat isi payload
            </div>
          )}
        </div>
      </div>

      {/* Action controls bottom bar */}
      <div className="flex items-center justify-between pt-2 border-t border-[#30363d]/50">
        <div className="flex items-center space-x-2 text-xs text-gray-400 font-mono">
          <Info className="w-4 h-4 text-gray-500" />
          <span>Aksi yang lolos verifikasi siap dijalankan secara aman.</span>
        </div>
        
        <button
          onClick={() => onExecute(manifest.actions)}
          disabled={isExecuting || !isAllValid}
          className={`flex items-center space-x-2 px-5 py-2 text-xs font-semibold rounded transition-all shadow ${
            isAllValid 
              ? "bg-[#2ea043] hover:bg-[#2c974b] text-white"
              : "bg-[#30363d] hover:bg-[#444c56] text-gray-500 border border-[#444c56] cursor-not-allowed"
          }`}
          id="approve-run-manifest-btn"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>SETUJUI & JALANKAN</span>
        </button>
      </div>
    </div>
  );
}
