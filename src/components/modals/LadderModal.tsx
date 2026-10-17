import { useRef, useState, type CSSProperties } from "react";
import copy from "copy-to-clipboard";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import "../../styles/Ladder.css";
import { useLadder } from "../../hooks/useLadder";
import { useModal } from "../../context/ModalContext";
import { Button, Chip, CourtLoader } from "../ui";
import SwapText from "../motion/SwapText";
import { reducedFade, staggerContainer, staggerItem, swap } from "../../motion/variants";
import { visibleGames } from "../../utils/GameUtils";
import { RANK_COLORS, RANK_TAGLINES, rankLabel, percentileShareText } from "../../utils/ranks";
import {
  aheadCopy, gateCopy, nextRankCopy, percentileHeadline, sameRankCopy, softCapCopy, streakCopy, toTopCopy,
  type LadderData, type LadderRow,
} from "../../utils/ladder";

interface LadderModalProps { onClose: () => void }

/** "40%" / "2.5%": one decimal only below 10 %, so small shares don't all read "0%". */
const sharePct = (row: LadderRow) => `${row.share_pct.toFixed(row.share_pct < 10 && row.share_pct > 0 ? 1 : 0)}%`;

/** Rank distribution, percentile thresholds and the daily rules — the one screen that explains the climb. */
export default function LadderModal({ onClose }: LadderModalProps) {
  const { loading, error, data, refresh } = useLadder();
  const { open } = useModal();
  const swapVariants = useReducedMotion() ? reducedFade : swap;
  const state = loading ? "loading" : error || !data ? "error" : "ready";

  // Loader <-> error <-> ladder cross-fade (UI-22); opacity/transform only, the modal panel's
  // height is never animated (as in LeaderboardModal).
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={state} variants={swapVariants} initial="hidden" animate="visible" exit="exit">
        {state === "loading" ? (
          <div className="ld-center"><CourtLoader label="Reading the standings…" scale={0.7} /></div>
        ) : state === "error" || !data ? (
          <div className="ld-center ld-error">
            <p>Couldn't load the ladder.</p>
            <Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>
          </div>
        ) : (
          <Ladder data={data} onClose={onClose} onSignUp={() => open("login")} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Ladder({ data, onClose, onSignUp }: { data: LadderData; onClose: () => void; onSignUp: () => void }) {
  const { you, ladder, percentiles, rules, total_players } = data;
  const [shared, setShared] = useState(false);
  const timer = useRef<number | null>(null);
  const share = async () => {
    if (!you) return;
    const text = percentileShareText(you.percentile, you.rank);
    try {
      if (typeof navigator !== "undefined" && navigator.share) { await navigator.share({ text }); return; }
    } catch { /* sheet dismissed: fall through */ }
    copy(text);
    setShared(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShared(false), 1600);
  };
  const myIndex = you ? ladder.findIndex((r) => r.name === you.rank) : -1;
  const games = visibleGames.filter((g) => g.maxPoints > 0);
  // The bars are drawn for sighted readers only; the same numbers are read out in one label.
  const ladderLabel = `Share of players at each rank: ${ladder.map((r) => `${r.name} ${sharePct(r)}`).join(", ")}`;

  return (
    <div className="ld">
      {/* You / guest hero */}
      <section className="ld-hero" style={{ "--rank-color": (you && RANK_COLORS[you.rank]) || "var(--brand)" } as CSSProperties}>
        <span className="ld-badge" aria-hidden="true">★</span>
        {you ? (
          <div className="ld-hero-text">
            <span className="ld-eyebrow">{rankLabel(you.rank, you.division)} · #{you.position.toLocaleString()} of {total_players.toLocaleString()}</span>
            <h3 className="font-display ld-headline">{percentileHeadline(you, total_players)}</h3>
            <p className="ld-sub">{aheadCopy(you)} · {sameRankCopy(you)}</p>
            <p className="ld-next tnum"><SwapText>{nextRankCopy(you)}</SwapText></p>
          </div>
        ) : (
          <div className="ld-hero-text">
            <span className="ld-eyebrow">Playing as guest</span>
            <h3 className="font-display ld-headline">Claim your rank</h3>
            <p className="ld-sub">Sign up to see where you stand against {total_players.toLocaleString()} players.</p>
          </div>
        )}
        <div className="ld-hero-actions">
          {you ? (
            <Button size="sm" onClick={share}><SwapText reserveWidth={["Share", "Copied!"]}>{shared ? "Copied!" : "Share"}</SwapText></Button>
          ) : (
            <Button size="sm" onClick={onSignUp}>Sign up</Button>
          )}
        </div>
      </section>

      <div className="ld-cols">
        {/* The ladder: one series (share of players), one bar colour; the rank's own colour rides the dot. */}
        <section aria-label="Rank ladder">
          <h4 className="ld-h">The ladder</h4>
          <motion.ol className="ld-rows" variants={staggerContainer} initial="hidden" animate="visible" role="img" aria-label={ladderLabel}>
            {ladder.map((row, i) => {
              const state = myIndex < 0 ? "" : i < myIndex ? " is-passed" : i === myIndex ? " is-you" : i === myIndex + 1 ? " is-next" : "";
              return (
                <motion.li key={row.name} variants={staggerItem} className={`ld-row${state}`}>
                  <span className="ld-dot" style={{ background: RANK_COLORS[row.name] ?? "var(--muted)" }} aria-hidden="true" />
                  <span className="ld-row-main">
                    <span className="ld-row-name">
                      {row.name}
                      {myIndex >= 0 && i === myIndex && <Chip variant="brand">you</Chip>}
                      {myIndex >= 0 && i === myIndex + 1 && <Chip>next</Chip>}
                    </span>
                    <span className="ld-row-tag">{RANK_TAGLINES[row.name]}</span>
                    <span className="ld-bar" aria-hidden="true"><span className="ld-bar-fill" style={{ width: `${Math.max(row.share_pct, row.players > 0 ? 1.5 : 0)}%` }} /></span>
                  </span>
                  <span className="ld-row-side tnum">
                    <span className="ld-row-gate">{gateCopy(row)}</span>
                    <span className="ld-row-pct">{sharePct(row)}</span>
                  </span>
                </motion.li>
              );
            })}
          </motion.ol>
          <h4 className="ld-h ld-h-gap">Top percentiles</h4>
          <div className="ld-chips">
            {Object.entries(percentiles).map(([p, pts]) => (
              <Chip key={p} className="tnum">{toTopCopy(Number(p), pts, you ? you.to_top?.[p] ?? null : null)}</Chip>
            ))}
          </div>
        </section>

        {/* How points work */}
        <section aria-label="How points work">
          <h4 className="ld-h">How points work</h4>
          <ul className="ld-games">
            {games.map((g) => (
              <li key={g.id}><span>{g.name}</span><span className="tnum">up to {g.maxPoints} pts</span></li>
            ))}
          </ul>
          <ul className="ld-rules">
            <li><strong className="tnum">+{rules.first_game_bonus}</strong> for your first scoring game of the day</li>
            <li>{softCapCopy(rules)}</li>
            <li>{streakCopy(rules)}</li>
            <li>Ranks need points <em>and</em> active days — they never drop</li>
            {!you && <li>Sign up and keep up to <span className="tnum">{rules.guest_carryover_max.toLocaleString()}</span> guest points</li>}
          </ul>
        </section>
      </div>

      <div className="ld-foot">
        <Button block variant="secondary" onClick={onClose}>Back to the game</Button>
      </div>
    </div>
  );
}
