"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notify";
import { captureWebException } from "@/lib/sentry";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary yakaladı:", error, errorInfo);
    captureWebException(error, { componentStack: errorInfo.componentStack });
    notify.error(error.message || "Bu bölüm yüklenirken beklenmeyen bir hata oluştu.");
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="glass rounded-2xl p-8 max-w-md w-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-danger" />
            </div>
            <h2 className="text-xl font-bold mb-2">
              Beklenmeyen Bir Hata Oluştu
            </h2>
            <p className="text-text-secondary text-sm mb-2">
              Bu bölüm yüklenirken bir sorunla karşılaşıldı.
            </p>
            {this.state.error && (
              <p className="text-text-muted text-xs font-mono bg-abyss rounded-lg p-3 mb-6 overflow-auto max-h-24 break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.handleRetry}
              className="bg-accent hover:bg-accent-dim text-midnight font-semibold px-6 py-2.5 rounded-xl inline-flex items-center gap-2 transition-all text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Tekrar Dene
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
