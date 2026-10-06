import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Modal from "./ui/Modal";
import { useModal, type FeedbackPayload, type InstructionsPayload, type LeaderboardPayload } from "../context/ModalContext";
import type { LeaderboardScope } from "../hooks/useLeaderboard";
import LogInSignUp from "./LogInSignUp";
import FeedbackModal from "./modals/FeedbackModal";
import LeaderboardModal from "./modals/LeaderboardModal";
import InstructionsModal from "./modals/InstructionsModal";
import MultiplayerInfoModal from "./modals/MultiplayerInfoModal";

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

  // Each time the leaderboard modal opens, start on the scope the opener asked for.
  // Adjusted during render (not in an effect) so the first frame already has the
  // right title and list — no Global -> Friends swap on open.
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
  const [prevKind, setPrevKind] = useState(kind);
  if (kind !== prevKind) {
    setPrevKind(kind);
    if (kind === "leaderboard") setLeaderboardScope((payload as LeaderboardPayload | undefined)?.scope ?? "global");
  }

  let title = "";
  let wide = false;
  let content: React.ReactNode = null;

  if (kind === "login") {
    title = authMode === "signup" ? "Create account" : "Welcome back";
    content = <LogInSignUp mode={authMode} onModeChange={setAuthMode} onClose={close} />;
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
  }

  return (
    <AnimatePresence>
      {kind && (
        <Modal key={kind} title={title} onClose={close} wide={wide}>
          {content}
        </Modal>
      )}
    </AnimatePresence>
  );
}
