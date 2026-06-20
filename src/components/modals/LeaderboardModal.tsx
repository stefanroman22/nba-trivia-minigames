import { useLeaderboard } from "../../hooks/useLeaderboard";
import { Avatar, CourtLoader } from "../ui";
import { initials, avatarBg, SELF_AVATAR_BG } from "../../constants/leaderboard";

/** Full "Global Top 100" list shown inside the leaderboard modal. */
export default function LeaderboardModal() {
  const { loading, leaders, self } = useLeaderboard();
  const selfInList = leaders.some((u) => u.rank === self.rank && u.name === self.name);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
        <CourtLoader label="Loading the board…" scale={0.7} />
      </div>
    );
  }

  return (
    <div>
      <div className="lbf-head">
        <span style={{ color: "var(--muted)" }}>Top players worldwide</span>
        <span style={{ color: "var(--brand)", fontWeight: 700 }}>
          You: #{self.rank.toLocaleString()} / {self.total.toLocaleString()}
        </span>
      </div>

      <div className="lbf-list">
        {leaders.map((u) => {
          const isSelf = u.rank === self.rank && u.name === self.name;
          return (
            <div key={`${u.rank}-${u.name}`} className={`lbf-row${isSelf ? " is-self" : ""}`}>
              <span className="tnum lbf-rank" style={{ color: u.rank <= 3 ? "var(--brand)" : "var(--muted)" }}>{u.rank}</span>
              <Avatar initials={initials(u.name)} size={30} bg={avatarBg(u.rank)} />
              <span className="lbf-name">{u.name}</span>
              <span className="tnum lbf-pts">{u.points.toLocaleString()}</span>
            </div>
          );
        })}
      </div>

      {!selfInList && (
        <div className="lbf-selfbar">
          <div className="lbf-selfbar-inner">
            <span className="tnum lbf-rank" style={{ width: "auto", minWidth: 34, color: "var(--brand)" }}>{self.rank.toLocaleString()}</span>
            <Avatar initials={initials(self.name)} size={30} bg={SELF_AVATAR_BG} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{self.name}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Keep playing to break into the top 100</span>
            </span>
            <span className="tnum lbf-pts">{self.points.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
