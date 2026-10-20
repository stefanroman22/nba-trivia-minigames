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
  aheadCopy, gateCopy, nextRankCopy, percentileHeadline, sameRankCopy, streakBonusCopy, freezeCopy, toTopCopy,
  type LadderData, type LadderRow, type LadderRules,
} from "../../utils/ladder";

interface LadderModalProps { onClose: () => void }

/** "40%" / "2.5%" / "<0.1%": one decimal only below 10 %, so small shares don't all read "0%". */
const sharePct = (row: LadderRow) =>
  row.share_pct > 0 && row.share_pct < 0.1 ? "<0.1%" : `${row.share_pct.toFixed(row.share_pct < 10 && row.share_pct > 0 ? 1 : 0)}%`;
const isNum = (v: unknown): v is number => typeof v === "number";

/** Rank distribution, percentile thresholds and the daily rules — the one screen that explains the climb. */
export default function LadderModal({ onClose }: LadderModalProps) {
  const { loading, error, unavailable, data, refresh } = useLadder();
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
            {unavailable ? (
              <p>The rank ladder isn't available on this server yet.</p>
            ) : (
              <>
                <p>Couldn't load the ladder.</p>
                <Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>
              </>
            )}
          </div>
        ) : (
          <Ladder data={data} onClose={onClose} onSignUp={() => open("login")} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Ladder({ data, onClose, onSignUp }: { data: LadderData; onClose: () => void; onSignUp: () => void }) {
  const { you, ladder, percentiles } = data;
  // An older backend may send fewer fields: a missing rule just drops its line.
  const total = data.total_players ?? 0;
  const rules: Partial<LadderRules> = data.rules ?? {};
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

  return (
    <div className="ld">
      {/* You / guest hero */}
      <section className="ld-hero" style={{ "--rank-color": (you && RANK_COLORS[you.rank]) || "var(--brand)" } as CSSProperties}>
        <span className="ld-badge" aria-hidden="true">★</span>
        {you ? (
          <div className="ld-hero-text">
            <span className="ld-eyebrow">{rankLabel(you.rank, you.division)} · #{you.position.toLocaleString()}{you.position <= total && ` of ${total.toLocaleString()}`}</span>
            <h3 className="font-display ld-headline">{percentileHeadline(you, total)}</h3>
            <p className="ld-sub">{aheadCopy(you)} · {sameRankCopy(you)}</p>
            <p className="ld-next tnum"><SwapText>{nextRankCopy(you)}</SwapText></p>
          </div>
        ) : (
          <div className="ld-hero-text">
            <span className="ld-eyebrow">Playing as guest</span>
            <h3 className="font-display ld-headline">Claim your rank</h3>
            <p className="ld-sub">
              Sign up to see where you stand against other players.
            </p>
          </div>
        )}
        <div className="ld-hero-actions">
          {you ? (
            <Button size="sm" onClick={share}><SwapText reserveWidth={["Share", "Copied!"]}>{shared ? "Copied!" : "Share"}</SwapText></Button>
          ) : (
            <Button size="sm" onClick={onSignUp}>Log in / Sign up</Button>
          )}
        </div>
      </section>

      <div className="ld-cols">
        {/* The ladder: one series (share of players), one bar colour; the rank's own colour rides the dot.
            The bars are decorative (aria-hidden): each row's share is also its text. */}
        <section aria-label="Rank ladder">
          <h4 className="ld-h">The ladder</h4>
          <motion.ol className="ld-rows" variants={staggerContainer} initial="hidden" animate="visible">
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
                    <span className="ld-bar" aria-hidden="true"><span className="ld-bar-fill" style={{ "--w": Math.min(100, Math.max(row.share_pct, row.players > 0 ? 1.5 : 0)) / 100 } as CSSProperties} /></span>
                  </span>
                  <span className="ld-row-side tnum">
                    <span className="ld-row-gate">{gateCopy(row)}</span>
                    <span className="ld-row-pct">{sharePct(row)}</span>
                  </span>
                </motion.li>
              );
            })}
          </motion.ol>
          {total > 0 && (
            <>
              <h4 className="ld-h ld-h-gap">Top percentiles</h4>
              <div className="ld-chips">
                {Object.entries(percentiles ?? {}).map(([p, pts]) => (
                  <Chip key={p} className="tnum">{toTopCopy(Number(p), pts, you ? you.to_top?.[p] ?? null : null)}</Chip>
                ))}
              </div>
            </>
          )}
        </section>

        {/* How points work */}
        <section aria-label="How points work">
          <h4 className="ld-h">How points work</h4>
          <ul className="ld-games">
            {games.map((g) => (
              <li key={g.id}><span>{g.name}</span><span className="tnum">up to {g.maxPoints.toLocaleString("en-US")} pts</span></li>
            ))}
          </ul>
          <ul className="ld-rules">
            {isNum(rules.first_game_bonus) && <li><strong className="tnum">+{rules.first_game_bonus}</strong> for your first scoring game of the day</li>}
            {rules.streak_milestones && isNum(rules.max_freezes) && isNum(rules.freeze_every_days) && (
              <>
                <li><strong>Streak bonus, added automatically:</strong> <span className="tnum">{streakBonusCopy(rules as LadderRules)}</span></li>
                <li>{freezeCopy(rules as LadderRules)}</li>
              </>
            )}
            {!you && isNum(rules.guest_carryover_max) && <li>Sign up and keep up to <span className="tnum">{rules.guest_carryover_max.toLocaleString()}</span> guest points</li>}
          </ul>
        </section>
      </div>

      <div className="ld-foot">
        <Button block variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
