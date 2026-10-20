"use client";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from '../../hooks/useNavigate';
import { useDispatch } from 'react-redux';
import { games, visibleGames } from '../../utils/GameUtils';
import Navigation from '../../components/Navigation';
import { useModal } from '../../context/ModalContext';
import { useMultiplayer } from '../../context/MultiplayerContext';
import { useRoomGuard } from '../../hooks/useRoomGuard';
import GameResult from '../../components/GameResult';
import OnlineMatch from '../../components/MultiPlayer/OnlineMatch';
import MultiplayerPanel from '../../components/MultiPlayer/MultiplayerPanel';
import { renderGame } from '../../Game Renderers/RenderGame';
import type { AppDispatch } from '../../store';
import { applyAward, type AwardReceipt } from '../../store/userSlice';
import { showErrorAlert } from '../../utils/Alerts';
import type { Game, GameData } from '../../types/types';
import type { AnswerReview } from '../../types/review';
import { reviewRounds } from '../../utils/reviewRounds';
import { apiFetch, getAccessToken } from '../../utils/Api';
import { addGuestPoints } from '../../utils/guestPoints';
import { flushSeenToServer, syncSeenFromServer } from '../../utils/seen';
import { BACKEND_ORIGIN } from '../../configurations/backend';
import SwapText from '../../components/motion/SwapText';
import { AutoSize } from '../../components/motion/AutoHeight';
import { GAME_IN_PROGRESS } from '../../constants/messages';
import { useDailyCardState } from '../../hooks/useDailyCardState';
import { DAILY_COPY, fetchDailyStatus, formatDailyCountdown, isDailyLockGame, type DailyStatus } from '../../utils/wordleDaily';
import { Stage, CourtLoader, Button, Chip } from '../../components/ui';
import { FeedbackSlotContext } from '../../context/FeedbackSlotContext';
import { FOCUSABLE } from '../../hooks/useFocusTrap';
import { reducedFade, swap } from "../../motion/variants";
import { useReducedMotionSafe } from "../../hooks/useReducedMotionSafe";
import "../../styles/MiniGame.css";

// NOTE: there is deliberately no hand-maintained list of content-stage game ids here any more.
// Whether a game hugs its content or fills the stage is declared by the game
// itself via <GameFrame fill>, and `.playing-wrap` reads that with :has() (see
// MiniGame.css). The old hand-maintained id list drifted out of sync and left
// several games with 100-230px of dead space above the Exit button.

const RAIL_STRIP_KEY = "sq:rail-strip-x";

function MiniGame() {
  // Opacity-only idle swap under reduced motion; null (pre-hydration) counts as not reduced (UI-20).
  const swapVariants = useReducedMotionSafe() ? reducedFade : swap;
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { open } = useModal();
  const { mp } = useMultiplayer();
  const { confirmLeave } = useRoomGuard();
  const pathname = usePathname();
  // Every game is routed at its urlPath, so the URL alone resolves the game —
  // deep-links and reloads included.
  const gameId = games.find(g => g.urlPath === pathname)?.id;
  const game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameData, setGameData] = useState<GameData[]>([]);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  // An in-place game (answers stay on screen) has ended: its ScorePanel now owns
  // the only "Close game", so the shell's leave link becomes "Report a problem" or is hidden (one per screen).
  const [endedInPlace, setEndedInPlace] = useState(false);
  // The finished game's answer review: which questions it dealt, for "Report a problem".
  const [review, setReview] = useState<AnswerReview | undefined>(undefined);
  // The shell feedback slot node (in .playing-wrap, above Exit) that every game's
  // "Correct! +10" popup portals into — one consistent spot across all games.
  const [feedbackSlot, setFeedbackSlot] = useState<HTMLDivElement | null>(null);
  // Epoch ms the current single-player play started (set when the stage
  // enters "playing") — feeds the session timer + duration logging.
  const playStartRef = useRef(0);
  // Pressing Play unmounts the focused button; hand focus to the first control of the playing board
  // (callback ref: runs once when .playing-wrap mounts, never on first page load, which renders idle).
  const focusFirstIn = useCallback((el: HTMLDivElement | null) => {
    // Skip on touch devices: focusing an <input> there opens the soft keyboard and shrinks the 100dvh stage.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, []);
  const prevStageRef = useRef("idle");
  // Guarantees a finished game awards profile points exactly once — shared by
  // the result-overview and the in-place (answers-in-view) end paths.
  const awardedRef = useRef(false);
  // Bumped on every new run (Play / game switch) and read back when the
  // background log-session call lands, so a slow response from a previous run
  // can't surface an error alert over a run that's already been restarted.
  const runIdRef = useRef(0);
  const mountedRef = useRef(false);
  // Desktop rail: matched to the stage's actual rendered height (which varies
  // by game and by phase) so the "all games" list is as tall as the game
  // container instead of shrinking to its own content or a fixed cap.
  const stageColRef = useRef<HTMLElement | null>(null);

  // Mobile game strip: keep the horizontal position the player left it at across game switches
  // (each switch mounts a fresh page), instead of jumping back to the first chip. Before paint, so
  // there's no visible jump; if the current game's chip would be off-screen, bring it into view.
  const railStripRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const strip = railStripRef.current;
    if (!strip) return;
    try {
      strip.scrollLeft = Number(sessionStorage.getItem(RAIL_STRIP_KEY)) || 0;
    } catch {
      // storage blocked: start at the beginning
    }
    const active = strip.querySelector<HTMLElement>('[aria-current="true"]');
    if (active) {
      const a = active.getBoundingClientRect();
      const box = strip.getBoundingClientRect();
      if (a.left < box.left || a.right > box.right) strip.scrollLeft += a.left - box.left - 16;
    }
  }, [gameId]);
  const saveRailStrip = () => {
    try {
      sessionStorage.setItem(RAIL_STRIP_KEY, String(railStripRef.current?.scrollLeft ?? 0));
    } catch {
      // storage blocked: the position just isn't remembered
    }
  };
  const [railHeight, setRailHeight] = useState<number | null>(null);
  // Daily games only (Wordle, Contexto): whether this account/browser already played today's puzzle.
  // Re-checked every time we land on idle for one, so it's fresh both on
  // first load and after finishing a run (Close game).
  const [dailyStatus, setDailyStatus] = useState<DailyStatus | null>(null);
  const [, forceCountdownTick] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const el = stageColRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRailHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // An online match takes over the whole stage area. A friend-room lobby does
  // NOT — the stage stays idle (with Play disabled) while the room card waits.
  const inLobby = mp.phase === "lobby";
  const online = mp.phase !== "idle" && !inLobby;

  const handleStart = async () => {
    if (!game) return;
    setLoading(true);
    setGameStarted(true);
    setScore(0);
    setShowResult(false);
    setEndedInPlace(false);
    setReview(undefined);
    awardedRef.current = false;
    runIdRef.current += 1;
    // The account's seen set (signed in): fetched during the warm-up, waited on for at most 1.5 s.
    const seenSync = syncSeenFromServer(game.id);
    setTimeout(async () => {
      if (!game) return;
      await seenSync;
      const result = await game.fetchData();
      if (result.success) {
        setGameData(result.data ?? []);
      } else {
        game.handleError(result.error ?? { title: "Something went wrong", message: "Please try again." });
        setGameStarted(false);
      }
      setLoading(false);
    }, 2000);
  };

  const handleRestart = async () => {
    setGameStarted(false);
    setGameData([]);
    setScore(0);
    setShowResult(false);
    setEndedInPlace(false);
    setReview(undefined);
  };

  const handleExit = () => {
    setGameData([]);
    setGameStarted(false);
    setLoading(false);
    setEndedInPlace(false);
    setReview(undefined);
  };

  useEffect(() => {
    setLoading(false);
    setGameStarted(false);
    setGameData([]);
    setScore(0);
    setShowResult(false);
    setEndedInPlace(false);
    setReview(undefined);
    awardedRef.current = false;
    runIdRef.current += 1;
  }, [gameId]);

  // Log a finished single-player game exactly once (guarded by awardedRef).
  // The session log is also what awards the points: the server records the
  // GameSession, clamps the score and credits the account in one step, then
  // reports back what it actually granted. We trust that number, not ours —
  // the client no longer tells the backend how many points it deserves.
  //
  // This runs in the background: the result screen never waits on it, so a
  // slow or failed request can't delay or break the reveal.
  const awardPoints = async (finalScore: number) => {
    if (awardedRef.current) return;
    awardedRef.current = true;
    if (!game) return;
    const runId = runIdRef.current;
    // Guests have no account to credit: keep a display-only total for this tab (GuestPanel).
    if (!getAccessToken()) addGuestPoints(finalScore);
    try {
      // apiFetch only attaches the JWT when one exists, so guests log anonymously
      // and are simply awarded nothing.
      const response = await apiFetch(`${BACKEND_ORIGIN}/trivia/log-session/`, {
        method: "POST",
        body: JSON.stringify({
          game: game.id,
          mode: "single",
          score: finalScore,
          duration_ms: playStartRef.current ? Date.now() - playStartRef.current : 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.error) {
        // Only complain about the run the player is still looking at.
        if (mountedRef.current && runIdRef.current === runId) showErrorAlert(data.error, "Saving your score failed!");
      } else if (typeof data.awarded === "number") {
        // The server has already credited the account; the receipt carries its totals, the new rank
        // and progress, so applying it late (even after Play again) can't drift from the backend.
        dispatch(applyAward(data as AwardReceipt));
      }
    } catch (err) {
      console.error("Network error:", err);
    }
  };

  // A game is "locked in" while actively playing single-player, in an online
  // match, or waiting in a friend room. Locked rail/strip items stay pressable:
  // a press explains (solo) or asks before leaving (room or match).
  const inProgress = (gameStarted && !showResult) || online || inLobby;
  // Picking another game while in a room or match asks first (useRoomGuard), then goes;
  // searching and the "Match ended" screen just leave. The current game's own item does nothing.
  const goToGame = (g: Game) => {
    if (g.id === game?.id) return;
    if (mp.phase !== "idle") { void confirmLeave().then((ok) => { if (ok) navigate(g.urlPath, { state: { id: g.id } }); }); return; }
    if (inProgress) { showErrorAlert(GAME_IN_PROGRESS, "Game in progress", "Continue playing"); return; }
    navigate(g.urlPath, { state: { id: g.id } });
  };

  // ---- Derive the single-player stage phase ----
  let stage: "idle" | "loading" | "playing" | "result";
  if (showResult) stage = "result";
  else if (loading) stage = "loading";
  else if (gameStarted && gameData.length > 0) stage = "playing";
  else stage = "idle";

  // Stamp the play start whenever the stage transitions into "playing".
  useEffect(() => {
    if (stage === "playing" && prevStageRef.current !== "playing") playStartRef.current = Date.now();
    prevStageRef.current = stage;
  }, [stage]);

  // Daily games only: check the once-per-day gate whenever we land on idle for one.
  useEffect(() => {
    if (!isDailyLockGame(gameId) || stage !== "idle") { setDailyStatus(null); return; }
    let cancelled = false;
    fetchDailyStatus(gameId).then((status) => { if (!cancelled) setDailyStatus(status); });
    return () => { cancelled = true; };
  }, [gameId, stage]);

  const dailyCards = useDailyCardState();
  const dailyLocked = isDailyLockGame(gameId) && !!dailyStatus?.locked;

  // Tick the countdown copy once a minute while it's actually shown — the
  // deadline itself lives on the server response, this just forces a re-render.
  useEffect(() => {
    if (!dailyLocked) return;
    const id = setInterval(() => forceCountdownTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [dailyLocked]);

  // "Report a problem" (shell-owned, both end paths): the questions this game dealt, if any carry an id.
  const reportRounds = reviewRounds(review);
  const reportable = !!game && reportRounds.length > 0;
  const openReport = () => { if (game) open("reportQuestion", { game: game.id, rounds: reportRounds }); };

  const renderStage = () => {
    switch (stage) {
      case "idle":
        return (
          <div className="idle">
            <div className="idle-thumb" style={{ backgroundImage: game?.backgroundImage }} />
            <div className="idle-head">
              <p className="font-display" style={{ fontSize: 23, margin: 0 }}>{game?.name}</p>
              <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>{game?.description}</p>
            </div>
            <div className="idle-chips">
              <Chip>{game?.roundsLabel ?? "5 rounds"}</Chip>
              {(game?.maxPoints ?? 0) > 0 && (
                <Chip>up to <span className="tnum" style={{ color: "var(--brand)", fontWeight: 700, marginLeft: 4 }}>{game?.maxPoints.toLocaleString("en-US")}</span> pts</Chip>
              )}
            </div>
            {/* One slot, three states: the Play button's height is reserved (.idle-action) so a
                swap never moves the chips; the countdown tick inside "locked" stays instant (timer). */}
            <div className="idle-action">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={inLobby ? "lobby" : dailyLocked && dailyStatus ? "locked" : "play"}
                  variants={swapVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {inLobby ? (
                    <p className="idle-room-note">
                      You're in a private room.
                    </p>
                  ) : dailyLocked && dailyStatus && isDailyLockGame(gameId) ? (
                    <p className="idle-room-note">
                      Next {DAILY_COPY[gameId].puzzle} available in {formatDailyCountdown(dailyStatus.nextResetAt)}.
                    </p>
                  ) : (
                    <Button size="lg" onClick={handleStart}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> Play
                    </Button>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        );
      case "loading":
        return <CourtLoader label="Warming up the court…" />;
      case "playing":
        return (
          <div className="playing-wrap" ref={focusFirstIn}>
            <FeedbackSlotContext.Provider value={feedbackSlot}>
              {renderGame({
                gameId: game?.id,
                gameData,
                pointsPerCorrect: game?.pointsPerCorrect,
                onGameEnd: (finalScore: number, opts?: { inPlace?: boolean; review?: AnswerReview }) => {
                  setScore(finalScore);
                  setReview(opts?.review);
                  // Fire-and-forget: the reveal doesn't wait for the award.
                  void awardPoints(finalScore);
                  // The questions dealt this game, one batched request to the account.
                  if (game) flushSeenToServer(game.id);
                  if (opts?.inPlace) setEndedInPlace(true);
                  else setShowResult(true);
                },
                onPlayAgain: handleStart,
                onClose: handleRestart,
              })}
            </FeedbackSlotContext.Provider>
            {/* Shell-owned feedback slot: game popups portal here so "Correct! +10"
                shows in one consistent spot in the gap above the leave link for every game.
                Hidden once an in-place game ends: the ScorePanel buttons take this spot (Rule 6.4). */}
            <div className={`feedback-slot${endedInPlace ? " is-ended" : ""}`} ref={setFeedbackSlot} aria-hidden="true" />
            {/* The one leave control while playing. Once an in-place game ends, its ScorePanel
                shows Play again + Close game, so this same link (same box, no shift) becomes
                "Report a problem"; a game with no reportable question hides and collapses it. */}
            <button
              className={`exit-link${endedInPlace ? (reportable ? " is-report" : " is-ended") : ""}`}
              onClick={endedInPlace && reportable ? openReport : handleExit}
            >
              <SwapText>{endedInPlace && reportable ? "Report a problem" : "Close game"}</SwapText>
            </button>
          </div>
        );
      case "result":
        // Wordle and Contexto are once per day: Play again would only hit the daily lock, so their result offers Close game alone.
        return <GameResult score={score} maxPoints={game?.maxPoints ?? 0} onPlayAgain={isDailyLockGame(gameId) ? undefined : handleStart} onClose={handleRestart} onReport={reportable ? openReport : undefined} />;
    }
  };

  return (
    <div className="app-shell">
      <Navigation type="back" />

      <main className="page game-page">
        {/* is-room: a private room is open (MiniGame.css) */}
        <div className={`game-grid${inLobby ? " is-room" : ""}`}>
          {/* Mobile game strip */}
          <div className="rail-strip" ref={railStripRef} onScroll={saveRailStrip}>
            {visibleGames.map((g) => (
              <button
                key={g.id}
                aria-current={g.id === game?.id ? "true" : undefined}
                className={`rail-chip${g.id === game?.id ? " is-active" : ""}${inProgress && g.id !== game?.id ? " is-locked" : ""}`}
                disabled={g.id === "coming-soon" || dailyCards.card(g.id).locked}
                onClick={() => goToGame(g)}
              >
                {g.name}
              </button>
            ))}
          </div>

          {/* Desktop rail */}
          <aside className="rail" aria-label="All games" style={railHeight != null ? { height: `min(${railHeight}px, calc(100dvh - 104px))` } : undefined}>
            <div className="rail-head"><span>ALL GAMES</span><span>{visibleGames.length}</span></div>
            <div className="rail-list">
              {visibleGames.map((g) => (
                <button
                  key={g.id}
                  disabled={g.id === "coming-soon" || dailyCards.card(g.id).locked}
                  onClick={() => goToGame(g)}
                  aria-current={g.id === game?.id ? "true" : undefined}
                  className={`rail-item${g.id === game?.id ? " is-active" : ""}${dailyCards.card(g.id).locked ? " is-played" : ""}${inProgress && g.id !== game?.id ? " is-locked" : ""}`}
                >
                  <span className="rail-thumb" style={{ backgroundImage: g.backgroundImage }} />
                  <span className="rail-meta">
                    <span className="rail-name">{g.name}</span>
                    <span className="rail-sub">
                      {dailyCards.card(g.id).label !== null
                        ? <SwapText swapKey="locked">{dailyCards.card(g.id).label}</SwapText>
                        : g.maxPoints > 0 ? `up to ${g.maxPoints.toLocaleString("en-US")} pts` : g.id === "coming-soon" ? "soon" : "opinion vote"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {/* Center stage */}
          <section className="stage-col" ref={stageColRef}>
            <div className="stage-title">
              <h1 className="font-display" style={{ fontSize: "clamp(19px,2.6vw,26px)" }}>{game?.name}</h1>
              <button className="info-btn" aria-label="How to play" onClick={() => game && open("instructions", { game, onPlay: stage === "idle" && !dailyLocked ? handleStart : undefined })}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              </button>
              {/* One chip whose label swaps (SwapText): three conditional <Chip>s reused one element and
                  changed its text instantly (UI_SHELL_CONSTRAINTS "State labels swap, never snap"). */}
              <AutoSize axis="width" style={{ marginLeft: "auto" }}>
                <Chip variant="brand" dot>
                  <SwapText>
                    {online ? (mp.roomType === "friend" ? "PRIVATE MATCH" : "ONLINE 1V1") : inLobby ? "PRIVATE ROOM" : game?.tag}
                  </SwapText>
                </Chip>
              </AutoSize>
            </div>

            <Stage phaseKey={online ? "online" : stage}>
              {online ? <OnlineMatch /> : renderStage()}
            </Stage>
          </section>

          {/* Aside: one merged Multiplayer card, same on mobile and desktop. */}
          <aside className="game-aside" aria-label="Multiplayer">
            <MultiplayerPanel game={game} gameStarted={gameStarted} showResult={showResult} />
          </aside>
        </div>
      </main>
    </div>
  );
}

export default MiniGame;
