import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

/**
 * App-level crash net. React has no hook equivalent — a class with
 * getDerivedStateFromError is still the React 19 pattern — so this stays the
 * one class component in the app.
 *
 * Without it, any render-time throw (a game renderer handed a malformed
 * multiplayer payload, say) unmounts the whole tree and leaves a white screen.
 * "Back to games" reloads at "/" rather than clearing the error in place: after
 * a crash the store/socket state that caused it is still there, so a fresh
 * document is the only reliably clean recovery.
 */
interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          background: "var(--bg)",
          color: "var(--text)",
          minHeight: "70vh",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 14,
          padding: "3rem 1.5rem",
          textAlign: "center",
        }}
      >
        <h2 className="font-display" style={{ fontSize: "clamp(1.4rem, 6vw, 2rem)" }}>
          Something broke
        </h2>
        <p style={{ fontSize: "1rem", color: "var(--muted)", lineHeight: 1.55, maxWidth: "42ch" }}>
          That&rsquo;s on us. The play broke down, but nothing you&rsquo;ve earned is lost.
        </p>
        <Button size="lg" onClick={() => window.location.assign("/")} style={{ marginTop: 8 }}>
          Back to games
        </Button>
      </div>
    );
  }
}
