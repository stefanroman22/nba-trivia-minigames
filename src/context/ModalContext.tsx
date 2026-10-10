import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Game } from "../types/types";
import type { LeaderboardScope } from "../hooks/useLeaderboard";

/** Which overlay is currently open. `null` = nothing open. */
export type ModalKind = "login" | "feedback" | "leaderboard" | "instructions" | "multiplayerInfo" | "gamePicker";

export interface InstructionsPayload {
  game: Game;
  /** Called by "Got it — let's play" when the game is idle. */
  onPlay?: () => void;
}

/** Which board the leaderboard modal opens on. Omitted = global. */
export interface LeaderboardPayload {
  scope: LeaderboardScope;
}

/** Feedback modal variant. `preset: "appeal"` is the ban screen's Appeal (BanNotice). */
export interface FeedbackPayload {
  preset?: "appeal";
  /** The banned account's public id, pre-filled into the appeal text. */
  publicId?: string;
}

/** The game picker (lobby "Change game", results "Change game"). */
export interface GamePickerPayload {
  /** The room's current game: listed but not pickable. */
  currentId?: string;
  /** Players seated now: games with a smaller cast are shown but disabled. */
  seated?: number;
  onPick: (game: Game) => void;
  title?: string;
}

// Per-kind payloads.
export type ModalPayload = InstructionsPayload | LeaderboardPayload | FeedbackPayload | GamePickerPayload | undefined;

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
