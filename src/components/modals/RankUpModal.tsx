import { useRef, useState } from "react";
import copy from "copy-to-clipboard";
import { motion } from "framer-motion";
import { Button } from "../ui";
import SwapText from "../motion/SwapText";
import { RANK_COLORS, rankLabel, shareText } from "../../utils/ranks";

interface RankUpModalProps {
  from: string;
  to: string;
  division: number | null;
  onClose: () => void;
  /** Opens the ladder in place of this modal. */
  onLadder?: () => void;
}

/** The rank-up moment: shown once per promotion (ModalHost opens it from user.pendingRankUp) after the
 *  game's own result, with a one-tap share. */
export default function RankUpModal({ from, to, division, onClose, onLadder }: RankUpModalProps) {
  const [shared, setShared] = useState(false);
  const timer = useRef<number | null>(null);
  const share = async () => {
    const text = shareText(to);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* dismissed the sheet: fall through to the clipboard */
    }
    copy(text);
    setShared(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShared(false), 1600);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="font-display"
        style={{ width: 96, height: 96, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color: "#101010", background: RANK_COLORS[to] ?? "var(--brand)" }}
        aria-hidden="true"
      >
        ★
      </motion.div>
      <h2 className="font-display" style={{ fontSize: 26 }}>{rankLabel(to, division)}</h2>
      <p style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 300, lineHeight: 1.5 }}>
        {from} → {to}. Keep playing a game a day to climb the ladder.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 10, width: "100%" }}>
        <Button block onClick={share}><SwapText>{shared ? "Copied!" : "Share"}</SwapText></Button>
        <Button block variant="secondary" onClick={onClose}>Keep playing</Button>
      </div>
      {onLadder && <button type="button" className="ld-link" onClick={onLadder}>See where you stand →</button>}
    </div>
  );
}
