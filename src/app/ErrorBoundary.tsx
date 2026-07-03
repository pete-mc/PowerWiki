import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Short label for what failed, woven into the fallback message. */
  readonly label?: string;
  /** Optional custom fallback; receives the error and a reset callback. */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * Catches render/lifecycle errors in its subtree so one failing area (the
 * Markdown preview, an editor, or the whole shell) degrades to a friendly
 * message with a retry instead of blanking the extension iframe. Give it a
 * `key` that changes on navigation to auto-reset when the user moves on.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: undefined };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log for diagnostics without taking down the host.
    console.error(`PowerWiki: ${this.props.label ?? "component"} failed to render`, error, info.componentStack);
  }

  private readonly reset = (): void => this.setState({ error: undefined });

  public override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="powerwiki-error-boundary" role="alert">
        <p className="powerwiki-error-boundary-title">
          <strong>Something went wrong{this.props.label ? ` in the ${this.props.label}` : ""}.</strong>
        </p>
        <p className="powerwiki-error-boundary-detail">{error.message}</p>
        <button className="powerwiki-error-boundary-retry" onClick={this.reset} type="button">
          Try again
        </button>
      </div>
    );
  }
}
