// The Heatmap — hex-grid category board. Click an unclaimed hex, name a real NBA
// player who satisfies that hex's criterion AND every neighbour hex's criterion.
// Correct -> hex claimed (+50 raw). No hearts; any hex, any number of attempts;
// "Give up" or a fully-claimed board ends it. Final score = min(300, raw) (profile
// cap). Follows the house timersRef/later()/clearTimers() pattern with a single
// guarded onGameEnd (GAME END CONTRACT).
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import ScorePanel from "../components/ScorePanel";
import { Button, GameFrame, Spinner } from "../components/ui";
import { currentLogoUrl } from "../constants/teamLogos";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { playerMatches } from "../utils/criteria";
import { matchAnswer, normalizeAnswer } from "../utils/answerMatch";
import { fetchWholePool } from "../utils/pool";
import type { HeatmapBoard, OnGameEnd, PlayerIndexEntry, Criterion } from "../types/types";
import "../styles/HeatmapGame.css";

interface HeatmapGameProps {
  gameInfo: HeatmapBoard[];
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  onClose?: () => void;
}

const ROW_WIDTHS = [4, 5, 5, 5, 5, 4];
const POINTS_PER_HEX = 50;
const PROFILE_CAP = 300;

interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number; }

/** Slice a board's hexes (ids row-major) into the template rows. */
function rowsOf<T extends { id: number }>(hexes: T[]): T[][] {
  const byId = [...hexes].sort((a, b) => a.id - b.id);
  const rows: T[][] = [];
  let i = 0;
  for (const w of ROW_WIDTHS) { rows.push(byId.slice(i, i + w)); i += w; }
  return rows;
}

export default function HeatmapGame({ gameInfo, onGameEnd, onPlayAgain, onClose }: HeatmapGameProps) {
  const [players, setPlayers] = useState<PlayerIndexEntry[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "empty">("loading");
  const [claimed, setClaimed] = useState<Record<number, boolean>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [guess, setGuess] = useState("");
  const [raw, setRaw] = useState(0);
  const [finished, setFinished] = useState(false);
  // End-state: the board stays in view; the bottom slot fades input → loader → score (§7b).
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ text: "", color: "" });
  const [hintFor, setHintFor] = useState<number | null>(null);
  // Mirrors `raw` so a delayed endGame() never scores off a stale render closure.
  const rawRef = useRef(0);
  const failsRef = useRef<Record<number, number>>({});
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const endedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const later = (fn: () => void, ms: number) => { timersRef.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  const board = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;
  const rows = useMemo(() => (board ? rowsOf(board.hexes) : []), [board]);
  const byId = useMemo(() => {
    const m: Record<number, HeatmapBoard["hexes"][number]> = {};
    board?.hexes.forEach((h) => { m[h.id] = h; });
    return m;
  }, [board]);
  const playerNames = useMemo(() => players.map((p) => p.full_name), [players]);

  // Fire-and-forget guess log (contract #7 flywheel). Reads the ref so the
  // unmount-cleanup closure always flushes the latest entries.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "heatmap", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // Fetch the curated players-index once (own loading/error/empty states).
  useEffect(() => {
    let alive = true;
    setLoadState("loading");
    fetchWholePool("players-index").then((res) => {
      if (!alive) return;
      if (!res.success || !res.data) { setLoadState("error"); return; }
      const rowsData = res.data as PlayerIndexEntry[];
      if (!rowsData.length) { setLoadState("empty"); return; }
      setPlayers(rowsData);
      setLoadState("ready");
    });
    return () => { alive = false; };
  }, []);

  // Fresh state whenever a new board loads (play-again).
  useEffect(() => {
    clearTimers();
    setClaimed({}); setActiveId(null); setGuess(""); setRaw(0); rawRef.current = 0;
    setFinished(false); setBottomPhase("input"); setShowPopup(false);
    failsRef.current = {}; setHintFor(null);
    guessLogRef.current = []; startRef.current = Date.now();
    endedRef.current = false;
  }, [gameInfo]);

  // Unmount: cancel pending work + flush guesses (stale onGameEnd is a known killed bug).
  useEffect(() => () => { clearTimers(); sendGuessLog(); }, []);

  const flashPopup = (text: string, color: string) => {
    setPopup({ text, color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  const neighborCriteria = (id: number): Criterion[] =>
    (byId[id]?.neighbors ?? []).map((n) => byId[n].criterion);

  const handleHexClick = (id: number) => {
    if (finished || claimed[id]) return;
    setActiveId(id);
    setHintFor((failsRef.current[id] || 0) >= 2 ? id : null);
    setGuess("");
  };

  const finish = (capped: number) => {
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd(capped, { inPlace: true });
  };

  // In-place end (§7b): the board stays on screen while the bottom slot swaps the
  // input for a 1.5s loader, then the score panel.
  const endGame = () => {
    if (finished) return;
    setFinished(true);
    sendGuessLog();
    setBottomPhase("loader");
    later(() => {
      finish(Math.min(PROFILE_CAP, rawRef.current));
      setBottomPhase("score");
    }, 1500);
  };

  const handleGuessSubmit = (submitted?: string) => {
    if (finished || activeId == null || !board) return;
    const id = activeId;
    const hex = byId[id];
    if (!hex) return;
    const rawInput = typeof submitted === "string" && submitted.trim() ? submitted : guess;
    setGuess("");
    const normalized = normalizeAnswer(rawInput);
    if (!normalized) return;

    const idx = matchAnswer(
      rawInput,
      players.map((p) => ({ answer: p.full_name, aliases: p.aliases })),
    );
    const elapsed = Date.now() - startRef.current;

    if (idx < 0) {
      failsRef.current[id] = (failsRef.current[id] || 0) + 1;
      guessLogRef.current.push({ question_id: `${board.qid}:${id}`, answer: normalized, correct: false, elapsed_ms: elapsed });
      if (failsRef.current[id] >= 2) setHintFor(id);
      flashPopup("Not an NBA player we know", "var(--bad)");
      return;
    }

    const player = players[idx];
    const required = [hex.criterion, ...neighborCriteria(id)];
    const ok = required.every((c) => playerMatches(player, c));

    guessLogRef.current.push({ question_id: `${board.qid}:${id}`, answer: player.full_name, correct: ok, elapsed_ms: elapsed });

    if (ok) {
      rawRef.current += POINTS_PER_HEX;
      setRaw((prev) => prev + POINTS_PER_HEX);
      const nextClaimed = { ...claimed, [id]: true };
      setClaimed(nextClaimed);
      setActiveId(null);
      setHintFor(null);
      flashPopup(`Correct! +${POINTS_PER_HEX}`, "var(--good)");
      if (Object.keys(nextClaimed).length === board.hexes.length) {
        later(() => endGame(), 900);
      }
    } else {
      failsRef.current[id] = (failsRef.current[id] || 0) + 1;
      if (failsRef.current[id] >= 2) setHintFor(id);
      flashPopup("Doesn't fit this hex + its neighbours", "var(--bad)");
    }
  };

  if (!board) return <p className="hm-msg">No board data available.</p>;
  if (loadState === "loading") return <Spinner label="Heating up the hexes…" />;
  if (loadState === "error") return <p className="hm-msg">Couldn't load players. Please try again later.</p>;
  if (loadState === "empty") return <p className="hm-msg">No player data available.</p>;

  const capped = Math.min(PROFILE_CAP, raw);
  const cleared = board.hexes.length > 0 && Object.keys(claimed).length === board.hexes.length;
  const hintCrits = hintFor != null ? neighborCriteria(hintFor) : [];

  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>CLAIM THE HEXES</GameFrame.Label>}
        right={<GameFrame.Score value={raw} />}
      />

      <div className="hm-board">
        {rows.map((row, r) => (
          <div key={r} className={`hm-row${r % 2 === 1 ? " is-indent" : ""}`}>
            {row.map((h) => {
              const isTeam = h.criterion.type === "team";
              const logo = isTeam ? currentLogoUrl(h.criterion.label) : null;
              const isClaimed = !!claimed[h.id];
              const isActive = activeId === h.id;
              return (
                <motion.button
                  key={h.id}
                  type="button"
                  className={`hm-hex${isClaimed ? " is-claimed" : ""}${isActive ? " is-active" : ""}`}
                  onClick={() => handleHexClick(h.id)}
                  disabled={finished || isClaimed}
                  aria-label={`${h.criterion.label}${isClaimed ? " (claimed)" : ""}`}
                  animate={reduce ? undefined : { scale: isActive ? 1.06 : 1 }}
                  transition={{ duration: 0.12 }}
                >
                  {logo ? (
                    <img
                      className="hm-hex-logo"
                      src={logo}
                      alt={h.criterion.label}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <span className="hm-hex-label">{h.criterion.label}</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        ))}
      </div>

      <GameFrame.Action>
      {hintFor != null && (
        <div className="hm-hint">
          Also needs to fit: <b>{hintCrits.map((c) => c.label).join(", ") || "no neighbours"}</b>
        </div>
      )}

      {/* Submission → loader → score, cross-faded in place (§7b) */}
      <EndSequence
        phase={bottomPhase}
        input={
          <GameFrame.InputRow>
            <AutocompleteInput
              placeholder={activeId == null ? "Tap a hex first…" : "Name a player…"}
              value={guess}
              setValue={setGuess}
              suggestions={playerNames}
              onSubmit={handleGuessSubmit}
              customStyleInput={{ width: "100%", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
              customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
            />
            <Button size="md" onClick={() => handleGuessSubmit()} disabled={finished || activeId == null || guess.trim() === ""}>
              Guess
            </Button>
            <Button size="md" variant="secondary" onClick={endGame} disabled={finished}>
              Give up
            </Button>
          </GameFrame.InputRow>
        }
        score={
          <>
            <ScorePanel
              score={capped}
              label={cleared ? "Board cleared!" : "Board done"}
              won={cleared}
              onPlayAgain={onPlayAgain}
              onClose={onClose}
            />
            {raw > capped && (
              <span className="hm-end-cap">
                Raw <span className="tnum">{raw}</span> · capped at <span className="tnum">{PROFILE_CAP}</span>
              </span>
            )}
          </>
        }
      />

      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popup.text} color={popup.color} />
    </GameFrame>
  );
}
