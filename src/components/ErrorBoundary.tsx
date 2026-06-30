import React, { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-6 bg-[#090d13] border border-red-500/20 rounded-lg text-center space-y-4 my-2">
          <div className="p-3 bg-red-950/30 border border-red-500/20 rounded-full">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <div className="space-y-1.5 max-w-sm">
            <h4 className="text-xs font-bold text-gray-200">Gagal Memuat Komponen Visual</h4>
            <p className="text-[11px] text-gray-400 leading-normal font-mono">
              {this.state.error?.message || "Terjadi kesalahan script saat memproses komponen eksternal."}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="flex items-center space-x-1 px-2.5 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-gray-200 rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Muat Ulang Komponen</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
