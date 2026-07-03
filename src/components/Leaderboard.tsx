import { AnimatePresence, motion } from 'framer-motion'
import "../styles/Leaderboard.css"
import { Avatar, CourtLoader } from './ui';
import { staggerContainer, staggerItem } from '../motion/variants';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { useModal } from '../context/ModalContext';
import { initials, avatarBg, SELF_AVATAR_BG } from '../constants/leaderboard';

/** How many rows the home card shows before "View all →" opens the full list. */
const PREVIEW_COUNT = 10;

/** Friendly "x ago" label for the last refresh time. */
function timeAgo(ts: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  return `${hr} hr${hr === 1 ? "" : "s"} ago`;
}

/** Home "Global Top 100" card. "View all →" opens the full leaderboard modal. */
function Leaderboard() {
  const { loading, leaders, self, refresh, refreshing, lastUpdated, now } = useLeaderboard();
  const { open } = useModal();
  const preview = leaders.slice(0, PREVIEW_COUNT);
  const selfInList = preview.some((u) => u.rank === self.rank && u.name === self.name);

  return (
    <div className="lb-card">
      <div className="lb-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17M14 14.66V17M18 2H6v7a6 6 0 0 0 12 0V2z" /></svg>
          <h3 className="font-display" style={{ fontSize: 17 }}>Global Top 100</h3>
        </div>
        <button className="lb-viewall" onClick={() => open("leaderboard")}>View all →</button>
      </div>

      <div className="lb-body">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
              <CourtLoader label="Loading the board…" scale={0.7} />
            </motion.div>
          ) : (
            <motion.div key={`rows-${preview.length}`} variants={staggerContainer} initial="hidden" animate="visible">
              {preview.map((u) => (
                <motion.div key={`${u.rank}-${u.name}`} variants={staggerItem} className="lb-row">
                  <span className="tnum" style={{ minWidth: 24, textAlign: "center", fontWeight: 700, fontSize: 13, color: u.rank <= 3 ? "var(--brand)" : "var(--muted)" }}>{u.rank}</span>
                  <Avatar initials={initials(u.name)} size={26} bg={avatarBg(u.rank)} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                  <span className="tnum" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--brand)" }}>{u.points.toLocaleString()}</span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!loading && !selfInList && (
        <div className="lb-self">
          <span className="tnum" style={{ minWidth: 34, textAlign: "center", fontWeight: 700, fontSize: 13, color: "var(--brand)" }}>{self.rank.toLocaleString()}</span>
          <Avatar initials={initials(self.name)} size={26} bg={SELF_AVATAR_BG} />
          <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5 }}>{self.name} <span style={{ fontWeight: 500, color: "var(--muted)", fontSize: 11.5 }}>· of {self.total.toLocaleString()}</span></span>
          <span className="tnum" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--brand)" }}>{self.points.toLocaleString()}</span>
        </div>
      )}

      <div className="lb-foot">
        <button className="lb-refresh" onClick={refresh} disabled={refreshing || loading}>
          <svg className={refreshing ? "lb-refresh-spin" : ""} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        {lastUpdated && <span className="lb-foot-note">Refreshed {timeAgo(lastUpdated, now)}</span>}
      </div>
    </div>
  )
}

export default Leaderboard
