import React, { useState, useEffect } from "react";
import { Settings, Cpu, ShieldCheck, ShieldAlert, RefreshCw, HelpCircle } from "lucide-react";

export type LLMProvider = "ollama" | "openrouter" | "gemini";

interface ProviderStatus {
  accessible: boolean;
  configured: boolean;
}

interface ProvidersStatusMap {
  ollama: ProviderStatus;
  openrouter: ProviderStatus;
  gemini: ProviderStatus;
}

interface ProviderSettingsProps {
  selectedProvider: LLMProvider;
  selectedModel: string;
  actualActiveModel?: string | null;
  onChange: (provider: LLMProvider, model: string) => void;
}

const POPULAR_MODELS: Record<LLMProvider, string[]> = {
  ollama: ["llama3", "mistral", "phi3", "gemma"],
  openrouter: [
    "openrouter/free",
    "google/gemma-4-26b-a4b-it-20260403:free",
    "meta-llama/llama-3-8b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "microsoft/phi-3-medium-128k-instruct:free"
  ],
  gemini: ["gemini-3.5-flash", "gemini-1.5-pro"]
};

export default function ProviderSettings({
  selectedProvider,
  selectedModel,
  actualActiveModel,
  onChange
}: ProviderSettingsProps) {
  const [statuses, setStatuses] = useState<ProvidersStatusMap>({
    ollama: { accessible: false, configured: true },
    openrouter: { accessible: false, configured: false },
    gemini: { accessible: false, configured: false }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelText, setCustomModelText] = useState("");

  const fetchStatuses = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && data.providers) {
          setStatuses(data.providers);
        }
      }
    } catch (err) {
      console.error("Failed to fetch provider statuses:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
  }, []);

  // Update custom model flag when provider changes
  useEffect(() => {
    const list = POPULAR_MODELS[selectedProvider];
    if (list && !list.includes(selectedModel)) {
      setIsCustomModel(true);
      setCustomModelText(selectedModel);
    } else {
      setIsCustomModel(false);
    }
  }, [selectedProvider]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const prov = e.target.value as LLMProvider;
    const defaultModel = POPULAR_MODELS[prov]?.[0] || "";
    setIsCustomModel(false);
    onChange(prov, defaultModel);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__custom__") {
      setIsCustomModel(true);
      onChange(selectedProvider, customModelText || "custom-model");
    } else {
      setIsCustomModel(false);
      onChange(selectedProvider, val);
    }
  };

  const handleCustomModelTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setCustomModelText(text);
    onChange(selectedProvider, text);
  };

  const currentStatus = statuses[selectedProvider];
  const isOk = selectedProvider === "ollama" ? currentStatus?.accessible : currentStatus?.configured;

  return (
    <div 
      className="p-3 bg-[#0d1117] border-t border-[#30363d] text-xs space-y-2 select-none"
      id="provider-settings-container"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-gray-400">
          <Settings className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span className="font-semibold tracking-wide text-gray-300 uppercase text-[10px]">
            Konfigurasi Model &amp; Provider
          </span>
        </div>
        
        <button 
          type="button"
          onClick={fetchStatuses}
          disabled={isLoading}
          className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#161b22] hover:bg-[#21262d] text-[10px] text-gray-400 hover:text-gray-200 border border-[#30363d] transition-colors cursor-pointer"
          title="Segarkan status provider"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin text-[#58a6ff]" : ""}`} />
          <span>Check Status</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Provider Select & Status */}
        <div className="space-y-1">
          <label className="block text-[10px] font-mono text-gray-400 uppercase">Provider</label>
          <div className="relative flex items-center bg-[#161b22] border border-[#30363d] rounded focus-within:border-[#58a6ff] overflow-hidden">
            <select
              value={selectedProvider}
              onChange={handleProviderChange}
              className="w-full bg-transparent text-gray-200 py-1.5 px-2.5 outline-none font-sans cursor-pointer pr-8"
              id="provider-select-dropdown"
            >
              <option value="ollama" className="bg-[#161b22]">Ollama (Lokal / Sandbox)</option>
              <option value="openrouter" className="bg-[#161b22]">OpenRouter.ai (Cloud)</option>
              <option value="gemini" className="bg-[#161b22]">Gemini API</option>
            </select>
            
            <div className="absolute right-2.5 pointer-events-none flex items-center space-x-1">
              {isOk ? (
                <ShieldCheck className="w-4 h-4 text-emerald-500" title="Provider Siap & Terkonfigurasi" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse" title="Perlu Konfigurasi / Offline" />
              )}
            </div>
          </div>
        </div>

        {/* Model Select */}
        <div className="space-y-1">
          <label className="block text-[10px] font-mono text-gray-400 uppercase">Model</label>
          <div className="flex space-x-1">
            {!isCustomModel ? (
              <select
                value={selectedModel}
                onChange={handleModelChange}
                className="w-full bg-[#161b22] border border-[#30363d] text-gray-200 rounded py-1.5 px-2.5 outline-none font-mono focus:border-[#58a6ff] cursor-pointer"
                id="model-select-dropdown"
              >
                {POPULAR_MODELS[selectedProvider]?.map((m) => (
                  <option key={m} value={m} className="bg-[#161b22] font-mono">{m}</option>
                ))}
                <option value="__custom__" className="bg-[#161b22] text-gray-400">Tulis model kustom...</option>
              </select>
            ) : (
              <div className="flex items-center bg-[#161b22] border border-[#30363d] rounded focus-within:border-[#58a6ff] overflow-hidden w-full">
                <input
                  type="text"
                  value={customModelText}
                  onChange={handleCustomModelTextChange}
                  placeholder="Ketik nama model..."
                  className="w-full bg-transparent text-gray-200 py-1.5 px-2.5 outline-none font-mono placeholder-gray-500"
                  id="custom-model-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomModel(false);
                    const def = POPULAR_MODELS[selectedProvider]?.[0] || "";
                    onChange(selectedProvider, def);
                  }}
                  className="px-2 py-1 text-[10px] font-sans text-gray-400 hover:text-gray-100 bg-[#21262d] border-l border-[#30363d] transition-colors"
                >
                  Batal
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedProvider === "openrouter" && (
        <div className="mt-2 p-2 bg-[#161b22] border border-[#30363d] rounded flex items-center justify-between text-[11px] text-gray-300 font-sans" id="active-model-info-banner">
          <div className="flex items-center space-x-1.5">
            <Cpu className="w-3.5 h-3.5 text-[#58a6ff]" />
            <span>Active Model: <strong className="font-mono text-[#58a6ff]">{actualActiveModel || selectedModel}</strong></span>
          </div>
        </div>
      )}

      {/* Warning Alert if not ready */}
      {!isOk && (
        <div className="p-2 bg-rose-950/20 border border-rose-900/30 rounded text-[11px] text-rose-400 flex items-start space-x-1.5">
          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            {selectedProvider === "openrouter" 
              ? "OPENROUTER_API_KEY belum dikonfigurasi di environment variables."
              : selectedProvider === "gemini"
              ? "GEMINI_API_KEY belum dikonfigurasi di environment variables."
              : "Ollama offline atau tidak terdeteksi berjalan di port 11434."}
          </span>
        </div>
      )}
    </div>
  );
}
