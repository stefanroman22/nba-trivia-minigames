import { motion } from "framer-motion";
import defaultAvatar from "../../assets/default.png";
import AnimatedNumber from "../motion/AnimatedNumber";

type CardState = "idle" | "playing" | "finished" | "offline";

interface PlayerCardProps {
  name?: string;
  photo?: string | null;
  /** Label under the name ("You", "Opponent", "Friend"…). */
  side: string;
  /** Final score, shown only once the match resolves. */
  score?: number | null;
  /** Live status pill (in-match). Omit to hide. */
  state?: CardState;
  /** Highlight ring on the results screen. */
  result?: "win" | "tie" | null;
  delay?: number;
}

const STATUS_LABEL: Record<CardState, string> = {
  idle: "Ready", playing: "Playing", finished: "Finished", offline: "Reconnecting",
};

/** Compact player tile used in the VS intro and the results matchup. */
export default function PlayerCard({
  name, photo, side, score = null, state, result = null, delay = 0,
}: PlayerCardProps) {
  return (
    <motion.div
      className={`om-pc${result ? ` is-${result}` : ""}`}
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="om-pc-avatar">
        <img
          src={photo || defaultAvatar}
          alt={name || "Player"}
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar; }}
        />
        {result === "win" && (
          <span className="om-pc-crown" aria-label="Winner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16l-2-9 5.5 4L12 5l3.5 6L21 7l-2 9H5zm0 2h14v2H5v-2z" /></svg>
          </span>
        )}
      </div>

      <span className="om-pc-name" title={name}>{name || "Player"}</span>
      <span className="om-pc-side">{side}</span>

      {state && (
        <span className={`om-pc-status is-${state}`}>
          {state === "playing" && <span className="om-dots"><i /><i /><i /></span>}
          {STATUS_LABEL[state]}
        </span>
      )}

      {score != null && (
        <span className="om-pc-score tnum"><AnimatedNumber value={Number(score)} /></span>
      )}
    </motion.div>
  );
}
