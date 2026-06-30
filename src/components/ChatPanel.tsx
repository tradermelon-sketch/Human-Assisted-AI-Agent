import React, { useState, useRef, useEffect } from "react";
import { 
  Send, Bot, User, FileText, FolderSync, Settings, 
  Loader2, Play, Eye, CheckCircle2, AlertTriangle, HelpCircle, RefreshCw,
  Globe, Sparkles
} from "lucide-react";
import { ChatMessage, ActionManifest } from "../types";
import ProviderSettings, { LLMProvider } from "./ProviderSettings";
import MarkdownRenderer from "./MarkdownRenderer";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, provider: string, model: string, onlineSearch: boolean) => void;
  isLoading: boolean;
  onSelectManifest: (manifest: ActionManifest, messageId: string) => void;
  activeManifestMessageId: string | null;
  actualActiveModel?: string | null;
}

export default function ChatPanel({
  messages,
  onSendMessage,
  isLoading,
  onSelectManifest,
  activeManifestMessageId,
  actualActiveModel
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [provider, setProvider] = useState<LLMProvider>("gemini");
  const [model, setModel] = useState("gemini-3.5-flash");
  const [onlineSearch, setOnlineSearch] = useState(true);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText, provider, model, onlineSearch);
    setInputText("");
  };

  const handleProviderSettingsChange = (newProvider: LLMProvider, newModel: string) => {
    setProvider(newProvider);
    setModel(newModel);
  };

  return (
    <div className="flex flex-col h-full bg-[#161b22] border-r border-[#30363d]" id="chat-panel-container">
      {/* Header Panel */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0d1117] border-b border-[#30363d]">
        <div className="flex items-center space-x-2">
          <Bot className="w-5 h-5 text-[#58a6ff]" />
          <div>
            <h1 className="text-sm font-semibold text-gray-200 tracking-tight">Human-Assisted Agent</h1>
            <p className="text-[11px] font-mono text-gray-400">STAGE 3 &bull; TRANSACTIONAL AGENT</p>
          </div>
        </div>
        
        {/* Connection status line as requested (Literal and functional only) */}
        <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#1c2128] border border-[#30363d]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-mono text-gray-400 uppercase">{provider}</span>
        </div>
      </div>


      {/* Messages List Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" id="chat-messages-scroll">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="p-3 bg-[#1f242c] rounded-full border border-[#30363d]">
              <Bot className="w-8 h-8 text-[#58a6ff]" />
            </div>
            <div className="max-w-xs">
              <p className="text-sm font-medium text-gray-300">Selamat Datang di Proxy Agent Workspace</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Ketik instruksi di bawah. Agen akan mengusulkan manipulasi berkas (file) sebagai manifest JSON untuk Anda setujui dan jalankan.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm pt-4">
              <button 
                onClick={() => setInputText("Tolong buat file test_file.py dengan isi script python sederhana.")}
                className="text-left text-[11px] font-mono p-2 bg-[#0d1117] hover:bg-[#1c2128] border border-[#30363d] rounded text-gray-300 transition-colors"
              >
                &gt; Buat berkas baru test_file.py
              </button>
              <button 
                onClick={() => setInputText("Baca isi file src/App.tsx")}
                className="text-left text-[11px] font-mono p-2 bg-[#0d1117] hover:bg-[#1c2128] border border-[#30363d] rounded text-gray-300 transition-colors"
              >
                &gt; Baca berkas src/App.tsx
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            const manifest = msg.parsedManifest;
            const isSelected = activeManifestMessageId === msg.id;

            return (
              <div 
                key={msg.id} 
                className={`flex space-x-3 max-w-[95%] ${isUser ? "ml-auto flex-row-reverse space-x-reverse" : ""}`}
                id={`chat-message-${msg.id}`}
              >
                {/* Avatar / Icon */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center border ${
                  isUser 
                    ? "bg-[#1f242c] border-[#30363d]" 
                    : "bg-[#0d1117] border-[#58a6ff]/20"
                }`}>
                  {isUser ? (
                    <User className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Bot className="w-4 h-4 text-[#58a6ff]" />
                  )}
                </div>

                {/* Message Bubble Body */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center space-x-2 text-[11px] text-gray-400 font-mono">
                    <span className="font-semibold">{isUser ? "USER" : "AGENT"}</span>
                    <span>&bull;</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  <div className={`p-3 rounded-lg border text-sm leading-relaxed ${
                    isUser 
                      ? "bg-[#1f242c] border-[#30363d] text-gray-200" 
                      : "bg-[#0d1117] border-[#30363d] text-gray-300"
                  }`}>
                    {/* Render message string */}
                    {msg.content && !manifest && (
                      <MarkdownRenderer content={msg.content} />
                    )}

                    {/* Render message containing plain conversational elements first */}
                    {msg.content && manifest && (
                      <div className="space-y-3">
                        {/* Show conversation parts if model added any reasoning before JSON */}
                        {(() => {
                          const rawLower = msg.content.trim();
                          const jsonStartIndex = rawLower.indexOf("{");
                          if (jsonStartIndex > 0) {
                            const preText = msg.content.substring(0, jsonStartIndex).trim();
                            if (preText) {
                              return (
                                <div className="border-b border-[#30363d]/50 pb-2 mb-2">
                                  <MarkdownRenderer content={preText} />
                                </div>
                              );
                            }
                          }
                          return null;
                        })()}

                        {/* Manifest Proposal Card Box */}
                        <div className={`rounded border ${
                          isSelected 
                            ? "bg-[#1c2c3e] border-[#58a6ff]" 
                            : "bg-[#1c1e22] border-[#e1b434]/40"
                        } p-3 space-y-2.5`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1.5">
                              <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e1b434] opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e1b434]"></span>
                              </span>
                              <span className="text-[11px] font-bold text-[#e1b434] font-mono tracking-wider uppercase">
                                PROPOSAL MANIFEST
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-gray-400 bg-[#2b2d31] px-1.5 py-0.5 rounded">
                              {manifest.actions.length} Aksi
                            </span>
                          </div>

                          <div className="space-y-1.5 border-t border-b border-[#30363d]/50 py-2">
                            {manifest.actions.map((act, idx) => {
                              let typeColor = "text-[#58a6ff]";
                              let typeLabel = "READ";
                              
                              if (act.type === "write_file") {
                                typeColor = "text-[#56d364]";
                                typeLabel = "WRITE";
                              } else if (act.type === "scan_directory") {
                                typeColor = "text-[#dbab09]";
                                typeLabel = "SCAN";
                              }

                              return (
                                <div key={idx} className="flex items-center space-x-2 text-[12px] font-mono">
                                  <span className={`text-[10px] font-bold px-1 py-0.2 rounded bg-opacity-10 ${typeColor} border border-current bg-[#000] border-opacity-10 w-[45px] text-center`}>
                                    {typeLabel}
                                  </span>
                                  <span className="text-gray-300 truncate max-w-[200px]" title={act.path}>
                                    {act.path}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Action review trigger button */}
                          <div className="flex items-center justify-end pt-1">
                            <button
                              onClick={() => onSelectManifest(manifest, msg.id)}
                              className={`flex items-center space-x-1.5 px-3 py-1 text-xs rounded font-medium transition-all ${
                                isSelected 
                                  ? "bg-[#58a6ff] hover:bg-[#4493f8] text-white cursor-default"
                                  : "bg-[#30363d] hover:bg-[#444c56] text-gray-200 border border-[#444c56]"
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isSelected ? "Sedang Direview" : "Review Manifest"}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Render search sources if available */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-[#30363d]/60 space-y-1.5" id="sources-container">
                        <span className="text-[10px] font-mono text-gray-500 tracking-wider flex items-center space-x-1">
                          <Globe className="w-3 h-3 text-[#3fb950]" />
                          <span>REFERENSI ONLINE / SUMBER PENCARIAN:</span>
                        </span>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {msg.sources.map((src, sIdx) => (
                            <a
                              key={sIdx}
                              href={src.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-[11px] transition-colors"
                            >
                              <span className="truncate max-w-[150px]">{src.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        
        {/* Loading Spinner Indicator */}
        {isLoading && (
          <div className="flex space-x-3 max-w-[90%]" id="chat-loading-indicator">
            <div className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-[#0d1117] border border-[#30363d]">
              <Loader2 className="w-4 h-4 text-[#58a6ff] animate-spin" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center space-x-2 text-[11px] text-gray-400 font-mono">
                <span className="font-semibold">AGENT</span>
                <span>&bull;</span>
                <span>Berpikir...</span>
              </div>
              <div className="p-3 rounded-lg border border-[#30363d] bg-[#0d1117] text-sm text-gray-400 flex items-center space-x-2">
                <span className="text-[12px] font-mono">Model sedang memproses instruksi Anda...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <ProviderSettings
        selectedProvider={provider}
        selectedModel={model}
        actualActiveModel={actualActiveModel}
        onChange={handleProviderSettingsChange}
      />

      {/* Input Message Box */}
      <form onSubmit={handleSubmit} className="p-3 bg-[#0d1117] border-t border-[#30363d] space-y-2.5" id="chat-input-form">
        {/* Grounding & Search Toggle Bar */}
        <div className="flex items-center justify-between px-1" id="online-search-toggle-container">
          <button
            type="button"
            onClick={() => setOnlineSearch(prev => !prev)}
            className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
              onlineSearch
                ? "bg-emerald-500/10 border-emerald-500/30 text-[#3fb950]"
                : "bg-gray-500/5 border-gray-500/20 text-gray-500"
            }`}
            title="Aktifkan pencarian online dan integrasi referensi eksternal"
            id="toggle-online-search-btn"
          >
            <Globe className={`w-3.5 h-3.5 ${onlineSearch ? "animate-pulse text-[#3fb950]" : ""}`} />
            <span>{onlineSearch ? "Pencarian Online: AKTIF" : "Pencarian Online: MATI"}</span>
          </button>
          
          <span className="text-[10px] font-mono text-gray-500" id="grounding-chunks-badge">
            Auto-Indexing Grounding Chunks
          </span>
        </div>

        <div className="relative flex items-center bg-[#161b22] border border-[#30363d] rounded-md focus-within:border-[#58a6ff] focus-within:ring-1 focus-within:ring-[#58a6ff]">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isLoading}
            placeholder="Instruksikan agen, misal: 'Tolong buat berkas python...'"
            className="flex-1 bg-transparent border-none text-xs text-gray-100 placeholder-gray-500 px-3 py-3 focus:outline-none disabled:opacity-50"
            id="chat-text-input"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="mr-2 p-2 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-gray-300 disabled:opacity-30 disabled:hover:bg-[#21262d] transition-colors"
            id="chat-send-btn"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
