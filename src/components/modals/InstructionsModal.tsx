import type { InstructionsPayload } from "../../context/ModalContext";

interface InstructionsModalProps extends InstructionsPayload {
  onClose: () => void;
}

/** "How to play" content: intro + numbered rules + a start CTA. */
export default function InstructionsModal({ game, onPlay, onClose }: InstructionsModalProps) {
  const handlePlay = () => {
    onClose();
    onPlay?.();
  };

  return (
    <div className="instr-stack">
      {game.intro && <p className="instr-intro">{game.intro}</p>}

      <div className="instr-rules">
        {(game.rules ?? []).map((rule) => (
          <div key={rule.n} className="instr-rule">
            <span className="instr-rule-n">{rule.n}</span>
            <p className="instr-rule-t">{rule.t}</p>
          </div>
        ))}
      </div>

      <button className="modal-primary-btn" style={{ height: 46 }} onClick={handlePlay}>
        Got it — let's play
      </button>
    </div>
  );
}
