import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Modal from "./ui/Modal";
import { useModal, type FeedbackPayload, type GamePickerPayload, type InstructionsPayload, type LeaderboardPayload } from "../context/ModalContext";
import { useMultiplayer } from "../context/MultiplayerContext";
import type { LeaderboardScope } from "../hooks/useLeaderboard";
import LogInSignUp, { type AuthPhase } from "./LogInSignUp";
import FeedbackModal from "./modals/FeedbackModal";
import LeaderboardModal from "./modals/LeaderboardModal";
import InstructionsModal from "./modals/InstructionsModal";
import MultiplayerInfoModal from "./modals/MultiplayerInfoModal";
import GamePickerModal from "./modals/GamePickerModal";

/**
 * Single overlay host (mounted once in App). The active modal is keyed so
 * <AnimatePresence> animates it in and out.
 */
export default function ModalHost() {
  const { kind, payload, close } = useModal();
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  // Each time the login modal opens, start on the Log in tab.
  useEffect(() => {
    if (kind === "login") setAuthMode("login");
  }, [kind]);

  // The game picker belongs to the room phase it was opened in (lobby or results): once the room
  // moves on (back to the lobby, a restart, the match ended), its pick would go nowhere, so close it.
  const phase = useMultiplayer().mp.phase;
  const pickerPhase = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "gamePicker") { pickerPhase.current = null; return; }
    if (pickerPhase.current === null) pickerPhase.current = phase;
    else if (pickerPhase.current !== phase) close();
  }, [kind, phase, close]);

  // Each time the leaderboard modal opens, start on the scope the opener asked for.
  // Adjusted during render (not in an effect) so the first frame already has the
  // right title and list — no Global -> Friends swap on open.
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
  // The auth form's phase: "success" turns the shell into its success takeover. Reset with the kind
  // (the exiting modal keeps the props it last rendered with, so its takeover exit still plays).
  const [authPhase, setAuthPhase] = useState<AuthPhase>("idle");
  const [prevKind, setPrevKind] = useState(kind);
  if (kind !== prevKind) {
    setPrevKind(kind);
    setAuthPhase("idle");
    if (kind === "leaderboard") setLeaderboardScope((payload as LeaderboardPayload | undefined)?.scope ?? "global");
  }

  let title = "";
  let wide = false;
  let takeover = false;
  let content: React.ReactNode = null;

  if (kind === "login") {
    title = authMode === "signup" ? "Create account" : "Welcome back";
    takeover = authPhase === "success";
    content = <LogInSignUp mode={authMode} onModeChange={setAuthMode} onClose={close} onPhaseChange={setAuthPhase} />;
  } else if (kind === "feedback") {
    const p = payload as FeedbackPayload | undefined;
    title = p?.preset === "appeal" ? "Appeal a ban" : "Share feedback";
    content = <FeedbackModal onClose={close} preset={p?.preset} publicId={p?.publicId} />;
  } else if (kind === "leaderboard") {
    title = leaderboardScope === "friends" ? "Friends leaderboard" : "Global Top 100";
    wide = true;
    content = <LeaderboardModal scope={leaderboardScope} onScopeChange={setLeaderboardScope} />;
  } else if (kind === "instructions") {
    title = "How to play";
    const p = payload as InstructionsPayload | undefined;
    content = p?.game ? <InstructionsModal game={p.game} onPlay={p.onPlay} onClose={close} /> : null;
  } else if (kind === "multiplayerInfo") {
    title = "Multiplayer";
    content = <MultiplayerInfoModal onClose={close} />;
  } else if (kind === "gamePicker") {
    const p = payload as GamePickerPayload | undefined;
    title = p?.title ?? "Change game";
    wide = true;
    content = p?.onPick ? <GamePickerModal currentId={p.currentId} seated={p.seated} onPick={p.onPick} onClose={close} /> : null;
  }

  return (
    <AnimatePresence>
      {kind && (
        <Modal key={kind} title={title} onClose={close} wide={wide} takeover={takeover}>
          {content}
        </Modal>
      )}
    </AnimatePresence>
  );
}
