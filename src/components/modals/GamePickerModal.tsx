import { visibleGames } from "../../utils/GameUtils";
import { NOT_ONLINE, roomBounds } from "../../utils/roomSizes";
import type { GamePickerPayload } from "../../context/ModalContext";

/** Grid of games to switch a room to. Scrolls inside the modal (a sheet on phones), never the page. */
export default function GamePickerModal({ currentId, seated = 0, onPick, onClose }: GamePickerPayload & { onClose: () => void }) {
  const games = visibleGames.filter((g) => !NOT_ONLINE.has(g.id));
  return (
    <div className="gp-scroll">
      <div className="gp-grid">
        {games.map((g) => {
          const { max } = roomBounds(g.id);
          const current = g.id === currentId;
          const tooSmall = seated > max;
          const note = current ? "Playing now" : tooSmall ? `${max} players only` : `up to ${g.maxPoints} pts`;
          return (
            <button
              key={g.id}
              type="button"
              className={`gp-item${current ? " is-current" : ""}`}
              aria-current={current ? "true" : undefined}
              disabled={current || tooSmall}
              onClick={() => { onClose(); onPick(g); }}
            >
              <span className="gp-thumb" style={{ backgroundImage: g.backgroundImage }} aria-hidden="true" />
              <span className="gp-name">{g.name}</span>
              <span className="gp-note">{note}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
