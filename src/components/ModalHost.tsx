import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useDispatch, useSelector } from "react-redux";
import Modal from "./ui/Modal";
import { useModal, type FeedbackPayload, type GamePickerPayload, type InstructionsPayload, type LeaderboardPayload, type MultiplayerInfoPayload, type RankUpPayload } from "../context/ModalContext";
import type { RootState } from "../store";
import { clearRankUp } from "../store/userSlice";
import { useMultiplayer } from "../context/MultiplayerContext";
import type { LeaderboardScope } from "../hooks/useLeaderboard";
import LogInSignUp, { type AuthPhase } from "./LogInSignUp";
import FeedbackModal from "./modals/FeedbackModal";
import LeaderboardModal from "./modals/LeaderboardModal";
import InstructionsModal from "./modals/InstructionsModal";
import MultiplayerInfoModal, { multiplayerInfoTitle } from "./modals/MultiplayerInfoModal";
import GamePickerModal from "./modals/GamePickerModal";
import RankUpModal from "./modals/RankUpModal";

// Lazy: it bundles every game's review view, which only a game page in a match ever opens.
const AnswerReviewModal = lazy(() => import("./modals/AnswerReviewModal"));

/**
 * Single overlay host (mounted once in App). The active modal is keyed so
 * <AnimatePresence> animates it in and out.
 */
export default function ModalHost() {
  const { kind, payload, open, close } = useModal();
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  // Each time the login modal opens, start on the Log in tab.
  useEffect(() => {
    if (kind === "login") setAuthMode("login");
  }, [kind]);

  // The game picker belongs to the room phase it was opened in (lobby, a live round, results): once
  // the room moves on (back to the lobby, a restart, the match ended), its pick would go nowhere, so
  // close it. Finishing your own round mid-pick (playing -> waiting) is still the same live round.
  const { mp } = useMultiplayer();
  const rawPhase = mp.phase;
  const phase = rawPhase === "waiting" ? "playing" : rawPhase;
  const pickerPhase = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "gamePicker") { pickerPhase.current = null; return; }
    if (pickerPhase.current === null) pickerPhase.current = phase;
    else if (pickerPhase.current !== phase) close();
  }, [kind, phase, close]);

  // The answer review belongs to the round you finished: once a new round starts (a restart, the
  // host switching games, back to the lobby) the store drops it, and the modal closes with it.
  useEffect(() => {
    if (kind === "answerReview" && !mp.review) close();
  }, [kind, mp.review, close]);

  // A promotion waits in the store until nothing else is open, then shows once (a beat after the
  // game's own result so the score lands first).
  const pendingRankUp = useSelector((s: RootState) => s.user.pendingRankUp);
  const reduxDispatch = useDispatch();
  useEffect(() => {
    if (!pendingRankUp || kind !== null) return;
    const id = window.setTimeout(() => {
      open("rankUp", pendingRankUp);
      reduxDispatch(clearRankUp());
    }, 1200);
    return () => window.clearTimeout(id);
  }, [pendingRankUp, kind, open, reduxDispatch]);

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
    title = authPhase === "name" ? "Pick your username" : authMode === "signup" ? "Create account" : "Welcome back";
    takeover = authPhase === "success";
    content = <LogInSignUp mode={authMode} onModeChange={setAuthMode} onClose={close} onPhaseChange={setAuthPhase} />;
  } else if (kind === "feedback") {
    const p = payload as FeedbackPayload | undefined;
    title = p?.preset === "appeal" ? "Appeal a ban" : "Share feedback";
    content = <FeedbackModal onClose={close} preset={p?.preset} publicId={p?.publicId} />;
  } else if (kind === "leaderboard") {
    title = leaderboardScope === "friends" ? "Friends leaderboard" : leaderboardScope === "weekly" ? "This week" : "Global Top 100";
    wide = true;
    content = <LeaderboardModal scope={leaderboardScope} onScopeChange={setLeaderboardScope} />;
  } else if (kind === "instructions") {
    title = "How to play";
    const p = payload as InstructionsPayload | undefined;
    content = p?.game ? <InstructionsModal game={p.game} onPlay={p.onPlay} onClose={close} /> : null;
  } else if (kind === "multiplayerInfo") {
    const context = (payload as MultiplayerInfoPayload | undefined)?.context;
    title = multiplayerInfoTitle(context);
    content = <MultiplayerInfoModal context={context} onClose={close} />;
  } else if (kind === "gamePicker") {
    const p = payload as GamePickerPayload | undefined;
    title = p?.title ?? "Change game";
    wide = true;
    content = p?.onPick ? <GamePickerModal currentId={p.currentId} seated={p.seated} onPick={p.onPick} onClose={close} /> : null;
  } else if (kind === "answerReview") {
    title = "Answers";
    wide = true;
    content = <Suspense fallback={null}><AnswerReviewModal /></Suspense>;
  } else if (kind === "rankUp") {
    const p = payload as RankUpPayload | undefined;
    title = "Rank up!";
    content = p ? <RankUpModal from={p.from} to={p.to} division={p.division} onClose={close} /> : null;
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
