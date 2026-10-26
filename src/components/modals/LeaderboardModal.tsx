import "../../styles/Leaderboard.css";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSelector } from "react-redux";
import type { RootState } from "../../store";
import { reducedFade, swap } from "../../motion/variants";
import { useLeaderboard, type LeaderboardScope } from "../../hooks/useLeaderboard";
import { friendPhotoUrl } from "../../hooks/useFriends";
import { Avatar, CourtLoader } from "../ui";
import SegmentedTabs from "../motion/SegmentedTabs";
import { initials, avatarBg, avatarFg, SELF_AVATAR_BG, LEADERBOARD_SCOPES, GUEST_LEADERBOARD_SCOPES } from "../../constants/leaderboard";

/** Full leaderboard list shown inside the leaderboard modal — Global top 100
 * or, once toggled, the signed-in player + their friends. The scope is
 * controlled by ModalHost so the modal title can follow it. */
interface LeaderboardModalProps {
  scope: LeaderboardScope;
  onScopeChange: (scope: LeaderboardScope) => void;
}

export default function LeaderboardModal({ scope: pickedScope, onScopeChange }: LeaderboardModalProps) {
  const loggedIn = useSelector((s: RootState) => s.user.user) !== null;
  const myPhoto = useSelector((s: RootState) => s.user.user?.profile_photo ?? null);
  // A player who logs out on Friends lands on Global (guests have no Friends tab).
  const scope: LeaderboardScope = !loggedIn && pickedScope === "friends" ? "global" : pickedScope;
  const { loading, leaders, self } = useLeaderboard(scope);
  const swapVariants = useReducedMotion() ? reducedFade : swap;
  // Nothing played this week: no weekly position (rank 0 = the API's null user_rank).
  const noWeeklyPosition = scope === "weekly" && self?.rank === 0;
  const selfInList = self ? leaders.some((u) => (self.id ? u.id === self.id : u.rank === self.rank && u.name === self.name)) : true;

  return (
    <div>
      <div className="lb-scope-row" style={{ padding: "0 0 14px" }}>
        <SegmentedTabs className="lb-scope" itemClassName="lb-scope-btn" options={loggedIn ? LEADERBOARD_SCOPES : GUEST_LEADERBOARD_SCOPES} value={scope} onChange={onScopeChange} />
      </div>

      {/* Loader <-> list (and Global <-> Friends) cross-fade; opacity/transform only, the
          modal panel's height is never animated (Modal.tsx height+layout jitter rule). */}
      <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div key="loading" variants={swapVariants} initial="hidden" animate="visible" exit="exit" style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
          <CourtLoader label="Loading the board…" scale={0.7} />
        </motion.div>
      ) : (
        <motion.div key={scope} variants={swapVariants} initial="hidden" animate="visible" exit="exit">
          <div className="lbf-head">
            <span style={{ color: "var(--muted)" }}>{scope === "friends" ? "You and your friends" : scope === "weekly" ? "Points since Monday" : "Top players worldwide"}</span>
            {self && (
              <span style={{ color: "var(--brand)", fontWeight: 700 }}>
                You: {noWeeklyPosition ? "—" : `#${self.rank.toLocaleString()}`} / {self.total.toLocaleString()}
              </span>
            )}
          </div>

          {leaders.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--muted)", fontSize: 13.5 }}>
              {scope === "weekly" ? "No games this week yet." : "No players yet."}
            </div>
          )}

          <div className="lbf-list">
            {leaders.map((u) => {
              const isSelf = self ? (self.id ? u.id === self.id : u.rank === self.rank && u.name === self.name) : false;
              return (
                <div key={u.id ?? `${u.rank}-${u.name}`} className={`lbf-row${isSelf ? " is-self" : ""}`}>
                  <span className="tnum lbf-rank" style={{ color: u.rank <= 3 ? "var(--brand)" : "var(--muted)" }}>{u.rank}</span>
                  <Avatar initials={initials(u.name)} size={30} bg={avatarBg(u.rank)} color={avatarFg(u.rank)} src={u.id ? friendPhotoUrl(u.id, u.photoVersion ?? 0) : null} />
                  <span className="lbf-name" style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }} title={u.id ? `${u.name} #${u.id}` : u.name}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                    {(u.id || u.rankName) && <span className="tnum" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>{[u.id && `#${u.id}`, u.rankName].filter(Boolean).join(" · ")}</span>}
                  </span>
                  <span className="tnum lbf-pts">{u.points.toLocaleString()}</span>
                </div>
              );
            })}
          </div>

          {self && !selfInList && !noWeeklyPosition && (
            <div className="lbf-selfbar">
              <div className="lbf-selfbar-inner">
                <span className="tnum lbf-rank" style={{ width: "auto", minWidth: 34, color: "var(--brand)" }}>{self.rank.toLocaleString()}</span>
                <Avatar initials={initials(self.name)} size={30} bg={SELF_AVATAR_BG} src={myPhoto} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{self.name}</span>
                  {self.id && <span className="tnum" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>#{self.id}</span>}
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Keep playing to break into the top 100</span>
                </span>
                <span className="tnum lbf-pts">{self.points.toLocaleString()}</span>
              </div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
