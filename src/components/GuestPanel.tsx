import { useModal } from "../context/ModalContext";

// Illustrative session points shown in the guest teaser (matches the design comp).
const GUEST_POINTS = 120;

const PERKS = ["Lock in your global rank", "1v1 online multiplayer", "Cross-device streak sync"];

/** Logged-out teaser shown beside the leaderboard, prompting sign-in. */
export default function GuestPanel() {
  const { open } = useModal();

  return (
    <div className="guest-panel">
      <div aria-hidden="true" className="guest-panel-glow" />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }}>
        <span className="guest-panel-eyebrow">PLAYING AS GUEST</span>
        <h3 className="font-display" style={{ fontSize: 21, lineHeight: 1.15 }}>Save your points &amp; challenge friends</h3>
        <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
          You've banked <strong style={{ color: "var(--text)" }} className="tnum">{GUEST_POINTS} pts</strong> this session.
          Log in to keep them, claim a rank, and play head-to-head online.
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
      <span className="guest-panel-note">No pressure — you can keep playing without an account.</span>
    </div>
  );
}
