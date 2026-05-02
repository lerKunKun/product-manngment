"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** 捕获子树渲染时抛错；显示降级 UI 而不是整页白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="mb-2 font-medium">页面渲染出错</div>
          <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-red-800/80">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="rounded border border-red-300 bg-white px-3 py-1 text-xs hover:bg-red-100"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
