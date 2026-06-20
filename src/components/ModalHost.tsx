import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Modal from "./ui/Modal";
import { useModal, type InstructionsPayload } from "../context/ModalContext";
import LogInSignUp from "./LogInSignUp";
import FeedbackModal from "./modals/FeedbackModal";
import LeaderboardModal from "./modals/LeaderboardModal";
import InstructionsModal from "./modals/InstructionsModal";

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

  let title = "";
  let wide = false;
  let content: React.ReactNode = null;

  if (kind === "login") {
    title = authMode === "signup" ? "Create account" : "Welcome back";
    content = <LogInSignUp mode={authMode} onModeChange={setAuthMode} onClose={close} />;
  } else if (kind === "feedback") {
    title = "Share feedback";
    content = <FeedbackModal onClose={close} />;
  } else if (kind === "leaderboard") {
    title = "Global Top 100";
    wide = true;
    content = <LeaderboardModal />;
  } else if (kind === "instructions") {
    title = "How to play";
    const p = payload as InstructionsPayload | undefined;
    content = p?.game ? <InstructionsModal game={p.game} onPlay={p.onPlay} onClose={close} /> : null;
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
