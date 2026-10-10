import { Component, type ReactNode } from "react";
import { Button } from "./ui";

interface State {
  error: Error | null;
}

/** Keeps a crash inside one tab from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-4 rounded-lg border border-danger/40 bg-danger-soft p-4 text-xs selectable">
        <div className="mb-1 text-[13px] font-semibold">This {this.props.label ?? "view"} hit an error</div>
        <pre className="mb-3 whitespace-pre-wrap font-mono">{this.state.error.message}</pre>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
