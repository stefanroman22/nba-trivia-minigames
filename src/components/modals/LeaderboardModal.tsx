import { useState } from "react";
import "../../styles/Leaderboard.css";
import { useLeaderboard, type LeaderboardScope } from "../../hooks/useLeaderboard";
import { Avatar, CourtLoader } from "../ui";
import { initials, avatarBg, SELF_AVATAR_BG } from "../../constants/leaderboard";

/** Full leaderboard list shown inside the leaderboard modal — Global top 100
 * or, once toggled, the signed-in player + their friends. */
export default function LeaderboardModal() {
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const { loading, leaders, self } = useLeaderboard(scope);
  const loggedIn = self !== null;
  const selfInList = self ? leaders.some((u) => (self.id ? u.id === self.id : u.rank === self.rank && u.name === self.name)) : true;

  return (
    <div>
      {loggedIn && (
        <div className="lb-scope-row" style={{ padding: "0 0 14px" }}>
          <div className="lb-scope">
            <button className={`lb-scope-btn${scope === "global" ? " is-active" : ""}`} onClick={() => setScope("global")}>Global</button>
            <button className={`lb-scope-btn${scope === "friends" ? " is-active" : ""}`} onClick={() => setScope("friends")}>Friends</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
          <CourtLoader label="Loading the board…" scale={0.7} />
        </div>
      ) : (
        <>
          <div className="lbf-head">
            <span style={{ color: "var(--muted)" }}>{scope === "friends" ? "You and your friends" : "Top players worldwide"}</span>
            {self && (
              <span style={{ color: "var(--brand)", fontWeight: 700 }}>
                You: #{self.rank.toLocaleString()} / {self.total.toLocaleString()}
              </span>
            )}
          </div>

          {leaders.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--muted)", fontSize: 13.5 }}>
              No players yet.
            </div>
          )}

          {scope === "friends" && leaders.length <= 1 && (
            <div style={{ textAlign: "center", padding: "0 0 1rem", color: "var(--muted)", fontSize: 13 }}>
              Add friends from your profile to build this board.
            </div>
          )}

          <div className="lbf-list">
            {leaders.map((u) => {
              const isSelf = self ? (self.id ? u.id === self.id : u.rank === self.rank && u.name === self.name) : false;
              return (
                <div key={u.id ?? `${u.rank}-${u.name}`} className={`lbf-row${isSelf ? " is-self" : ""}`}>
                  <span className="tnum lbf-rank" style={{ color: u.rank <= 3 ? "var(--brand)" : "var(--muted)" }}>{u.rank}</span>
                  <Avatar initials={initials(u.name)} size={30} bg={avatarBg(u.rank)} />
                  <span className="lbf-name" style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }} title={u.id ? `${u.name} #${u.id}` : u.name}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                    {u.id && <span className="tnum" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>#{u.id}</span>}
                  </span>
                  <span className="tnum lbf-pts">{u.points.toLocaleString()}</span>
                </div>
              );
            })}
          </div>

          {self && !selfInList && (
            <div className="lbf-selfbar">
              <div className="lbf-selfbar-inner">
                <span className="tnum lbf-rank" style={{ width: "auto", minWidth: 34, color: "var(--brand)" }}>{self.rank.toLocaleString()}</span>
                <Avatar initials={initials(self.name)} size={30} bg={SELF_AVATAR_BG} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{self.name}</span>
                  {self.id && <span className="tnum" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>#{self.id}</span>}
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Keep playing to break into the top 100</span>
                </span>
                <span className="tnum lbf-pts">{self.points.toLocaleString()}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
