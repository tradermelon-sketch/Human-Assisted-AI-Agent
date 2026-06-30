export interface Action {
  type: "read_file" | "scan_directory" | "write_file";
  path: string;
  content?: string;
}

export interface ActionManifest {
  actions: Action[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  parsedManifest?: ActionManifest | null;
  hasManifestError?: boolean;
}

export interface MemoryFile {
  filename: string;
  hash: string;
  last_updated: number;
}

export interface ValidationResult {
  index: number;
  action: Action;
  valid: boolean;
  error: string;
  resolved_path: string;
  syntax_error?: {
    message: string;
    line?: number;
    column?: number;
  };
}

export interface ExecutionStepReport {
  index: number;
  type: "read_file" | "scan_directory" | "write_file";
  path: string;
  status: "pending" | "running" | "success" | "failed" | "aborted";
  error: string;
  result: any;
}

export interface LongTermMemoryFact {
  id: string;
  category: "user" | "ai";
  content: string;
  timestamp: number;
}

