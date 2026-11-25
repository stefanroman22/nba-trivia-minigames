"use client";
/**
 * Public page of a published community game (/custom/<slug>), made in the admin Game Builder. Deliberately not a
 * game renderer and not part of the MiniGame shell: it is reached only by its link, awards no points and logs
 * nothing. It borrows the shell's look (the shared Stage, GameFrame via CustomGamePlayer, Button, Chip, CourtLoader)
 * and has five states: loading, not available (404: unknown slug or not published), a load error, the idle card and
 * the game (whose end screen belongs to the player).
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "../hooks/useNavigate";
import Navigation from "../components/Navigation";
import SwapText from "../components/motion/SwapText";
import { Button, Chip, CourtLoader, Stage } from "../components/ui";
import CustomGamePlayer from "../components/customGame/CustomGamePlayer";
import {
  GameNotAvailableError,
  fetchPublicGame,
  fetchPublicPlay,
  type PublicGame,
} from "../components/customGame/publicApi";
import { MODE_LABEL, type CustomPlay } from "../components/customGame/types";
import "../styles/CustomGame.css";

// Shortest time the loader stays up after Play, so it never flashes (the same hold as MiniGame's Play, Rule 3.1).
const LOADING_HOLD_MS = 800;

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; game: PublicGame };

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const isModifiedClick = (e: MouseEvent<HTMLElement>) => e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0;

export default function CustomGame({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [play, setPlay] = useState<{ data: CustomPlay; nonce: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Bumped by every start / leave, so a slow /play/ response for a run that was left is dropped.
  const run = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchPublicGame(slug, controller.signal)
      .then((game) => setLoad({ status: "ready", game }))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setLoad(e instanceof GameNotAvailableError ? { status: "missing" } : { status: "error", message: errorText(e, "Could not load this game.") });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  async function start() {
    if (starting) return;
    const mine = ++run.current;
    setStarting(true);
    setStartError(null);
    const hold = new Promise((resolve) => setTimeout(resolve, LOADING_HOLD_MS));
    try {
      const [data] = await Promise.all([fetchPublicPlay(slug), hold]);
      if (run.current === mine) setPlay({ data, nonce: mine });
    } catch (e) {
      if (run.current !== mine) return;
      if (e instanceof GameNotAvailableError) setLoad({ status: "missing" });
      else setStartError(errorText(e, "Could not load the rounds."));
    } finally {
      if (run.current === mine) setStarting(false);
    }
  }

  function leave() {
    run.current += 1;
    setPlay(null);
    setStarting(false);
    setStartError(null);
  }

  function replay() {
    setPlay(null);
    void start();
  }

  const homeLink = (
    <a
      className="btn btn-secondary btn-md"
      href="/"
      onClick={(e) => {
        if (isModifiedClick(e)) return;
        e.preventDefault();
        navigate("/");
      }}
    >
      Back to games
    </a>
  );

  let phase: string;
  let content: ReactNode;
  if (load.status === "loading") {
    phase = "loading";
    content = <CourtLoader label="Loading game…" />;
  } else if (load.status === "missing") {
    phase = "missing";
    content = (
      <div className="cg-idle">
        <p className="cg-note font-display">This game is not available.</p>
        {homeLink}
      </div>
    );
  } else if (load.status === "error") {
    phase = "error";
    content = (
      <div className="cg-idle">
        <p className="cg-note font-display">{load.message}</p>
        <div className="cg-actions">
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
          {homeLink}
        </div>
      </div>
    );
  } else if (play) {
    phase = "playing";
    content = (
      <CustomGamePlayer
        key={play.nonce}
        variant="stage"
        rounds={play.data.rounds}
        pointsPerCorrect={play.data.points_per_correct}
        maxPoints={play.data.max_points}
        exitLabel="Back"
        noPointsNote="Community games award no points."
        onExit={leave}
        onReplay={replay}
      />
    );
  } else if (starting) {
    phase = "starting";
    content = <CourtLoader label="Warming up the court…" />;
  } else {
    const { game } = load;
    phase = "idle";
    content = (
      <div className="cg-idle">
        {game.description && <p className="cg-desc">{game.description}</p>}
        <div className="cg-chips">
          <Chip>{MODE_LABEL[game.mode]}</Chip>
          <Chip>
            <span className="tnum">{game.rounds}</span> {game.rounds === 1 ? "round" : "rounds"}
          </Chip>
          <Chip>Community game</Chip>
          <Chip>No points</Chip>
        </div>
        <div className="cg-play">
          <Button size="lg" onClick={start}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>{" "}
            Play
          </Button>
        </div>
        {startError && (
          <p className="cg-error" role="alert">
            {startError}
          </p>
        )}
      </div>
    );
  }

  const title = load.status === "ready" ? load.game.title : "Community game";

  return (
    <div className="app-shell">
      <Navigation type="back" />
      <main className="page cg-page">
        <section className="cg-col">
          <div className="cg-title">
            <h1 className="font-display">
              <SwapText>{title}</SwapText>
            </h1>
          </div>
          <Stage phaseKey={phase}>{content}</Stage>
        </section>
      </main>
    </div>
  );
}
