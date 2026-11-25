/**
 * Plays the rounds of an AI-built custom game. Shared by the admin preview (Game Builder → Play, `variant="card"`) and
 * the public /custom/<slug> page (`variant="stage"`, inside the shared Stage, rooted at <GameFrame>). It is not a game
 * renderer: nothing is registered with the game catalogue or the MiniGame shell, and no points are awarded. Three
 * round kinds: multiple choice, type the answer and higher / lower. Keyboard: options and cards are real buttons,
 * Enter confirms a typed answer, and once a round is answered focus moves to "Next" so Enter keeps the game going.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Field, GameFrame, ProgressBar } from "../ui";
import AutoHeight from "../motion/AutoHeight";
import SwapText from "../motion/SwapText";
import { nameKey } from "../../utils/answerMatch";
import { fadeInUp, resultIn, swap } from "../../motion/variants";
import type { Round } from "./types";
import "../../styles/CustomGamePlayer.css";

interface Outcome {
  correct: boolean;
  /** What the player picked or typed; null when the round was skipped. */
  given: string | null;
}

/** Same matching key as the real games (lowercase, no accents, no spaces), then only letters and digits are kept. */
const answerKey = (s: string) => nameKey(s).replace(/[^\p{L}\p{N}]/gu, "");

function isCorrectTyped(round: Round, typed: string): boolean {
  const key = answerKey(typed);
  if (!key) return false;
  return [round.answer, ...(round.accepted ?? [])].some((a) => answerKey(a) === key);
}

/** Callback ref (stable identity, so it runs once on mount): the end screen mounts after the last round has faded out. */
const focusOnMount = (el: HTMLElement | null) => el?.focus();

const fmtValue = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtPoints = (n: number) => n.toLocaleString("en-US");

/** The correct answer as text (higher / lower stores the winning side, not its label). */
function answerText(round: Round): string {
  if (round.kind === "higher_lower") {
    return (round.answer === "left" ? round.left?.label : round.right?.label) ?? round.answer;
  }
  return round.answer;
}

/* ------------------------------------------------------------------ */
/*  Round kinds                                                        */
/* ------------------------------------------------------------------ */
interface RoundProps {
  round: Round;
  outcome: Outcome | null;
  onAnswer: (o: Outcome) => void;
}

function ChoiceRound({ round, outcome, onAnswer }: RoundProps) {
  return (
    <div className="gb-options" role="group" aria-label="Answer options">
      {(round.options ?? []).map((opt, i) => {
        const isAnswer = opt === round.answer;
        const isWrongPick = !!outcome && !isAnswer && opt === outcome.given;
        const state = outcome ? (isAnswer ? " is-correct" : isWrongPick ? " is-wrong" : " is-dim") : "";
        return (
          <button
            key={`${i}-${opt}`}
            type="button"
            className={`gb-option${state}`}
            aria-disabled={outcome ? true : undefined}
            onClick={() => {
              if (!outcome) onAnswer({ correct: isAnswer, given: opt });
            }}
          >
            <span className="gb-option-text">{opt}</span>
            {outcome && isAnswer && <span className="gb-mark" aria-hidden="true">✓</span>}
            {isWrongPick && <span className="gb-mark" aria-hidden="true">✕</span>}
          </button>
        );
      })}
    </div>
  );
}

function TypeRound({ round, outcome, onAnswer }: RoundProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = !!outcome;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const typed = text.trim();
    if (locked || !typed) return;
    onAnswer({ correct: isCorrectTyped(round, typed), given: typed });
  }

  return (
    <form className="gb-type" onSubmit={submit}>
      <Field
        ref={inputRef}
        className={outcome ? (outcome.correct ? "gb-input-good" : "gb-input-bad") : ""}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your answer"
        aria-label="Your answer"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        readOnly={locked}
      />
      <div className="gb-type-actions">
        <Button type="submit" size="sm" disabled={locked || !text.trim()}>
          Confirm
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={locked} onClick={() => onAnswer({ correct: false, given: null })}>
          Skip
        </Button>
      </div>
    </form>
  );
}

function CompareRound({ round, outcome, onAnswer }: RoundProps) {
  const sides = [
    ["left", round.left],
    ["right", round.right],
  ] as const;
  return (
    <div className="gb-compare" role="group" aria-label="Pick one">
      {sides.map(([key, side]) => {
        if (!side) return null;
        const isAnswer = key === round.answer;
        const state = outcome ? (isAnswer ? " is-correct" : key === outcome.given ? " is-wrong" : " is-dim") : "";
        return (
          <button
            key={key}
            type="button"
            className={`gb-side${state}`}
            aria-disabled={outcome ? true : undefined}
            onClick={() => {
              if (!outcome) onAnswer({ correct: isAnswer, given: key });
            }}
          >
            <span className="gb-side-label">{side.label}</span>
            {/* One element whose text swaps from "?" to the value, so the card keeps its height. */}
            <span className="gb-side-value tnum" aria-hidden={!outcome}>
              <SwapText>{outcome ? fmtValue(side.value) : "?"}</SwapText>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Result line + Next                                                 */
/* ------------------------------------------------------------------ */
function Feedback({ round, outcome, isLast, onNext }: { round: Round; outcome: Outcome | null; isLast: boolean; onNext: () => void }) {
  const actionsRef = useRef<HTMLDivElement>(null);

  // Answering moves focus to Next, so the keyboard flow is pick → Enter → pick …
  useEffect(() => {
    if (outcome) actionsRef.current?.querySelector("button")?.focus();
  }, [outcome]);

  let verdict = "";
  if (outcome) {
    const answer = answerText(round);
    if (outcome.correct) verdict = round.kind === "type_answer" ? `Correct: ${answer}` : "Correct!";
    else if (outcome.given === null) verdict = `Skipped. The answer is ${answer}.`;
    else verdict = `Not quite. The answer is ${answer}.`;
  }

  // The live region stays mounted (and empty, so it takes no space) so the result is announced when it appears.
  return (
    <div className="gb-result" aria-live="polite">
      {outcome && (
        <motion.div className="gb-result-body" variants={fadeInUp} initial="hidden" animate="visible">
          <p className={`gb-verdict ${outcome.correct ? "is-good" : "is-bad"}`}>{verdict}</p>
          {round.reveal && <p className="gb-reveal">{round.reveal}</p>}
          <div className="gb-next" ref={actionsRef}>
            <Button size="sm" onClick={onNext}>
              {isLast ? "Finish" : "Next"}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function RoundView({ round, outcome, isLast, onAnswer, onNext }: RoundProps & { isLast: boolean; onNext: () => void }) {
  return (
    <div className="gb-round">
      <p className="gb-prompt font-display">{round.prompt}</p>
      {round.kind === "multiple_choice" && <ChoiceRound round={round} outcome={outcome} onAnswer={onAnswer} />}
      {round.kind === "type_answer" && <TypeRound round={round} outcome={outcome} onAnswer={onAnswer} />}
      {round.kind === "higher_lower" && <CompareRound round={round} outcome={outcome} onAnswer={onAnswer} />}
      <Feedback round={round} outcome={outcome} isLast={isLast} onNext={onNext} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Player                                                             */
/* ------------------------------------------------------------------ */
export interface CustomGamePlayerProps {
  rounds: Round[];
  pointsPerCorrect: number;
  maxPoints: number;
  /** Label of the leave control ("Back to builder" in the admin preview, "Back" on the public page). */
  exitLabel: string;
  /** Said on the end screen after the tally, e.g. that nothing is awarded. */
  noPointsNote: string;
  /** "card": the admin preview's own surface. "stage": rooted at <GameFrame>, to sit inside the shared Stage. */
  variant?: "card" | "stage";
  /** Accessible name of the card variant's region. */
  ariaLabel?: string;
  onExit: () => void;
  /** "Play again": the parent fetches a fresh set of rounds. */
  onReplay: () => void;
}

export default function CustomGamePlayer({
  rounds,
  pointsPerCorrect,
  maxPoints,
  exitLabel,
  noPointsNote,
  variant = "card",
  ariaLabel = "Game preview",
  onExit,
  onReplay,
}: CustomGamePlayerProps) {
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const total = rounds.length;
  const round = rounds[index];
  const points = correctCount * pointsPerCorrect;
  const stage = variant === "stage";

  function answer(o: Outcome) {
    if (outcome) return;
    setOutcome(o);
    if (o.correct) setCorrectCount((c) => c + 1);
  }

  function next() {
    if (index + 1 >= total) {
      setFinished(true);
    } else {
      setIndex((i) => i + 1);
      setOutcome(null);
    }
  }

  if (total === 0 || !round) {
    const empty = <div className="gb-empty">This game has no playable rounds yet.{stage ? "" : " Refine it with a prompt, or check the warnings above."}</div>;
    if (stage) {
      return (
        <GameFrame>
          <GameFrame.Board>{empty}</GameFrame.Board>
          <GameFrame.Action>
            <Button variant="secondary" size="sm" onClick={onExit}>
              {exitLabel}
            </Button>
          </GameFrame.Action>
        </GameFrame>
      );
    }
    return (
      <div className="surface-2 gb-play">
        {empty}
        <div className="gb-end-actions">
          <Button size="sm" variant="secondary" onClick={onExit}>
            {exitLabel}
          </Button>
        </div>
      </div>
    );
  }

  const countLabel = finished ? "Finished" : `Round ${index + 1} of ${total}`;
  const progress = <ProgressBar value={finished ? total : index + (outcome ? 1 : 0)} max={total} label="Rounds completed" />;

  const body = (
    <AutoHeight style={stage ? { width: "100%" } : undefined}>
      <AnimatePresence mode="wait" initial={false}>
        {finished ? (
          <motion.div key="end" variants={swap} initial="hidden" animate="visible" exit="exit">
            <div className="gb-end">
              <h3 ref={focusOnMount} tabIndex={-1} className="gb-end-title font-display">
                Game over
              </h3>
              <motion.p className="gb-end-score font-display tnum" variants={resultIn}>
                {fmtPoints(points)}
                <span className="gb-end-max"> / {fmtPoints(maxPoints)} pts</span>
              </motion.p>
              <p className="gb-muted">
                {correctCount} of {total} correct. {noPointsNote}
              </p>
              <div className="gb-end-actions">
                <Button size="sm" onClick={onReplay}>
                  Play again
                </Button>
                <Button size="sm" variant="secondary" onClick={onExit}>
                  {exitLabel}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key={`${index}-${round.id}`} variants={swap} initial="hidden" animate="visible" exit="exit">
            <RoundView round={round} outcome={outcome} isLast={index + 1 >= total} onAnswer={answer} onNext={next} />
          </motion.div>
        )}
      </AnimatePresence>
    </AutoHeight>
  );

  if (stage) {
    return (
      <GameFrame>
        <GameFrame.Status
          left={
            <GameFrame.Label>
              <SwapText>{countLabel}</SwapText>
            </GameFrame.Label>
          }
          right={<GameFrame.Score value={points} />}
        />
        {progress}
        <GameFrame.Board>{body}</GameFrame.Board>
        {/* The end screen carries its own leave button next to Play again. */}
        <GameFrame.Action>
          {!finished && (
            <Button variant="ghost" size="sm" onClick={onExit}>
              {exitLabel}
            </Button>
          )}
        </GameFrame.Action>
      </GameFrame>
    );
  }

  return (
    <section className="surface-2 gb-play" aria-label={ariaLabel}>
      <header className="gb-play-head">
        <span className="gb-play-count tnum">
          <SwapText>{countLabel}</SwapText>
        </span>
        <span className="gb-play-score tnum">
          <SwapText>{`${fmtPoints(points)} pts`}</SwapText>
        </span>
        <button type="button" className="gb-exit gb-play-exit" onClick={onExit}>
          {exitLabel}
        </button>
      </header>
      {progress}
      {body}
    </section>
  );
}
