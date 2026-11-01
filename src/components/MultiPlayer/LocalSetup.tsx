// Local multiplayer's first screen, in the stage (GameFrame root, Rule 0): the two players' names, then Start. It is
// not an online match (MpState.phase stays idle, MP-5): MiniGame holds the names and deals the board on Start with the
// idle switch's difficulty. The shell's "Close game" link under it is the one leave control (Rule 4.6).
// Seats are Tic-Tac-Toe's (Player 1 is X, Player 2 is O), the only game with Game.localMultiplayer so far.
import { useState, type KeyboardEvent } from "react";
import { Button, Field, GameFrame } from "../ui";

const MAX_NAME = 16;
const SEATS = [
  { label: "Player 1 · X", fallback: "Player 1" },
  { label: "Player 2 · O", fallback: "Player 2" },
] as const;

interface LocalSetupProps {
  /** The names of the previous setup (a failed deal returns here), else empty fields. */
  initial?: readonly [string, string] | null;
  /** The idle switch's pick, shown so the players know which board they get ("Easy"). */
  difficultyLabel?: string;
  /** Trimmed names; an empty field is "Player 1" / "Player 2". */
  onStart: (names: [string, string]) => void;
}

export default function LocalSetup({ initial, difficultyLabel, onStart }: LocalSetupProps) {
  const [names, setNames] = useState<[string, string]>(() => [initial?.[0] ?? "", initial?.[1] ?? ""]);
  const start = () => onStart([names[0].trim() || SEATS[0].fallback, names[1].trim() || SEATS[1].fallback]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") start();
  };

  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>LOCAL MULTIPLAYER</GameFrame.Label>}
        right={difficultyLabel ? <GameFrame.Label>{difficultyLabel.toUpperCase()} BOARD</GameFrame.Label> : null}
      />
      <GameFrame.Prompt eyebrow="Two players, one device" title="Who's playing?" />
      <GameFrame.Board>
        <div className="ls-seats">
          {SEATS.map((seat, i) => (
            <label key={seat.label} className="ls-seat">
              <span className="ls-seat-label">{seat.label}</span>
              <Field
                value={names[i]}
                maxLength={MAX_NAME}
                placeholder={seat.fallback}
                autoComplete="off"
                enterKeyHint={i === 0 ? "next" : "go"}
                onChange={(e) => {
                  const v = e.target.value.slice(0, MAX_NAME);
                  setNames((n) => (i === 0 ? [v, n[1]] : [n[0], v]));
                }}
                onKeyDown={onKeyDown}
              />
            </label>
          ))}
        </div>
      </GameFrame.Board>
      <GameFrame.Action>
        <Button size="md" onClick={start}>
          Start
        </Button>
      </GameFrame.Action>
    </GameFrame>
  );
}
