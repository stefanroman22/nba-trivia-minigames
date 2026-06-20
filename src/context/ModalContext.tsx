import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Game } from "../types/types";

/** Which overlay is currently open. `null` = nothing open. */
export type ModalKind = "login" | "feedback" | "leaderboard" | "instructions";

export interface InstructionsPayload {
  game: Game;
  /** Called by "Got it — let's play" when the game is idle. */
  onPlay?: () => void;
}

// Per-kind payloads. Only `instructions` needs one today.
export type ModalPayload = InstructionsPayload | undefined;

interface ModalContextValue {
  kind: ModalKind | null;
  payload: ModalPayload;
  open: (kind: ModalKind, payload?: ModalPayload) => void;
  close: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<ModalKind | null>(null);
  const [payload, setPayload] = useState<ModalPayload>(undefined);

  const open = useCallback((next: ModalKind, nextPayload?: ModalPayload) => {
    setPayload(nextPayload);
    setKind(next);
  }, []);

  const close = useCallback(() => setKind(null), []);

  const value = useMemo(() => ({ kind, payload, open, close }), [kind, payload, open, close]);

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within a ModalProvider");
  return ctx;
}
