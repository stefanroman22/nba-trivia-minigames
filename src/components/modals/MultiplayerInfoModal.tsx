/** "How multiplayer works" content: intro + numbered rules, mirrors InstructionsModal's layout. */
export default function MultiplayerInfoModal({ onClose }: { onClose: () => void }) {
  const rules = [
    { n: "1", t: "Play 1v1 matches you against a random opponent, live, at the same time." },
    { n: "2", t: "Play with a friend opens a private room instead: generate a 6 digit code, or enter one a friend sent you." },
    { n: "3", t: "Once the room fills up, the match starts automatically for everyone in it." },
  ];

  return (
    <div className="instr-stack">
      <p className="instr-intro">Two ways to play against real people: a random opponent, or a private room with friends.</p>

      <div className="instr-rules">
        {rules.map((rule) => (
          <div key={rule.n} className="instr-rule">
            <span className="instr-rule-n">{rule.n}</span>
            <p className="instr-rule-t">{rule.t}</p>
          </div>
        ))}
      </div>

      <button className="modal-primary-btn" style={{ height: 46 }} onClick={onClose}>
        Got it
      </button>
    </div>
  );
}
