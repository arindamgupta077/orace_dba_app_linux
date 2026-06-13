"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="glass-panel max-w-lg rounded-lg p-6 text-center">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-300" />
          <h1 className="text-xl font-semibold">Console recovery required</h1>
          <p className="mt-2 text-sm text-muted-foreground">{this.state.message || "The DBA portal hit an unexpected client error."}</p>
          <Button className="mt-5" onClick={() => this.setState({ hasError: false, message: undefined })}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
