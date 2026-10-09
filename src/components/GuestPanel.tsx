import { useEffect, useState } from "react";
import { useModal } from "../context/ModalContext";
import { readGuestPoints } from "../utils/guestPoints";

const PERKS = ["Lock in your global rank", "1v1 online multiplayer", "Cross-device streak sync"];

/** Logged-out teaser shown beside the leaderboard, prompting sign-in. */
export default function GuestPanel() {
  const { open } = useModal();
  // What this tab actually scored as a guest (0 in a fresh or private window). Read after mount:
  // sessionStorage doesn't exist during server rendering.
  const [guestPoints, setGuestPoints] = useState(0);
  useEffect(() => setGuestPoints(readGuestPoints()), []);

  return (
    <div className="guest-panel">
      <div aria-hidden="true" className="guest-panel-glow" />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }}>
        <span className="guest-panel-eyebrow">PLAYING AS GUEST</span>
        <h3 className="font-display" style={{ fontSize: 21, lineHeight: 1.15 }}>Save your points &amp; challenge friends</h3>
        <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
          {guestPoints > 0 ? (
            <>
              You've scored <strong style={{ color: "var(--text)" }} className="tnum">{guestPoints} pts</strong> as a guest,
              which aren't saved. Log in so your next games count, claim a rank, and play head-to-head online.
            </>
          ) : (
            "Log in to save the points you score, claim a rank, and play head-to-head online."
          )}
        </p>
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }}>
        {PERKS.map((perk) => (
          <div key={perk} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--text)" }}>
            <span style={{ color: "var(--good)" }}>✓</span> {perk}
          </div>
        ))}
      </div>

      <button className="guest-panel-cta" onClick={() => open("login")}>Log in / Sign up</button>
      <span className="guest-panel-note">You can keep playing without an account.</span>
    </div>
  );
}
