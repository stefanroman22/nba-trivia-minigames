// Answer reviews for the board and mystery-player games. Each one redraws the game's own board
// (its exported pieces and CSS classes) read-only, with the answers filled in.
import TeamBadge from "../ui/TeamBadge";
import TeamNameGradient from "../ui/TeamNameGradient";
import PlayerPhoto from "../ui/PlayerPhoto";
import { Line } from "../../Game Renderers/Wordle";
import { RevealedFace } from "../../Game Renderers/StartingFive";
import { TIER_COLOR, TIER_INK } from "../../Game Renderers/ConnectionsGame";
import { TttBoard } from "../../Game Renderers/TicTacToe";
import { RevealHeadshot, stintYears } from "../../Game Renderers/CareerPath";
import { WayaRowBody } from "../../Game Renderers/WhoAreYa";
import { rankColor } from "../../Game Renderers/Contexto";
import { ImposterReveal } from "../../Game Renderers/ImposterGame";
import { teamNickname } from "../../utils/teamBadge";
import { ReviewPick, ReviewRound, ReviewSummary } from "./ReviewParts";
import type { AnswerReview } from "../../types/review";
import "../../styles/FanFavorites.css";
import "../../styles/HeatmapGame.css";
import "../../styles/NbaGrid.css";
import "../../styles/BingoGame.css";

type Of<G extends AnswerReview["game"]> = Extract<AnswerReview, { game: G }>;

const WORDLE_ROWS = 5;

const CHECK = (
  <svg className="ng-check" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Wordle: your rows on the game's tile board, then the answer as an all-green row. */
export function WordleReview({ review }: { review: Of<"wordle"> }) {
  const rows = Array.from({ length: WORDLE_ROWS }, (_, i) => review.guesses[i] ?? "");
  return (
    <>
      <ReviewSummary>
        {review.won
          ? <>Solved in <b className="tnum">{review.guesses.length}</b></>
          : <>Not solved in <span className="tnum">{WORDLE_ROWS}</span> tries</>}
      </ReviewSummary>
      <div className="ar-board">
        <div className="wordle-board" aria-label="Your guesses">
          {rows.map((g, i) => <Line key={i} guess={g} solution={review.solution} isSubmitted={!!g} />)}
        </div>
        <div className="ar-wordle-answer">
          <span className="ar-cap">The answer</span>
          <Line guess={review.solution} solution={review.solution} isSubmitted />
        </div>
      </div>
    </>
  );
}

/** Fill in the Starting 5: the scoreboard and all five cards face up, found in green, missed in red. */
export function StartingFiveReview({ review }: { review: Of<"starting-five"> }) {
  const m = review.matchup;
  const found = review.slots.filter((s) => s.found).length;
  const team = (name: string) => (
    <div className={`s5-team${m.winner === name ? " is-winner" : ""}`}>
      <TeamBadge name={name} surface="board" className="s5-team-badge" decorative />
      <span className="s5-team-name font-display">{name}</span>
    </div>
  );
  return (
    <>
      <ReviewSummary>You found <b className="tnum">{found}</b> of <span className="tnum">5</span></ReviewSummary>
      <div className="ar-board">
        <div className="s5-board">
          {team(m.teamA)}
          <div className="s5-score">
            <span className="s5-score-num tnum font-display">{m.score}</span>
            <span className="s5-score-date">
              {new Date(m.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
          {team(m.teamB)}
        </div>
        <div className="s5-cards">
          {review.slots.map((s) => (
            <div key={s.key} className={`s5-card${s.found ? " is-correct" : s.name ? " is-revealed" : ""}`}>
              <span className="s5-card-pos">{s.label}</span>
              <div className="s5-card-stage">
                <div className="s5-flip is-flipped">
                  <div className="s5-face s5-face--front" />
                  <div className="s5-face s5-face--back">{s.name && <RevealedFace name={s.name} />}</div>
                </div>
              </div>
              <div className="s5-card-foot"><span className="s5-card-name">{s.name ?? "—"}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Fan Favorites: the full survey board; the answers you named are lit. */
export function FanFavoritesReview({ review }: { review: Of<"fan-favorites"> }) {
  const hits = review.answers.filter((a) => a.hit).length;
  return (
    <>
      <ReviewSummary>You named <b className="tnum">{hits}</b> of <span className="tnum">{review.answers.length}</span></ReviewSummary>
      <p className="ar-prompt">{review.asked} <b>{review.prompt}</b></p>
      <div className="ar-board">
        <div className="ff-board">
          {review.answers.map((a, i) => (
            <div key={i} className={`ff-slot${a.hit ? " is-hit" : " is-missed"}`}>
              <span className="ff-rank tnum">{i + 1}</span>
              <span className="ff-answer">{a.answer}</span>
              <span className="ff-count tnum">{a.count}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** The Heatmap: your claimed hexes on the board, then every hex with who you named or a player who fit. */
export function HeatmapReview({ review }: { review: Of<"heatmap"> }) {
  const all = review.rows.flat();
  const claimed = all.filter((h) => h.claimedBy).length;
  return (
    <>
      <ReviewSummary>You claimed <b className="tnum">{claimed}</b> of <span className="tnum">{all.length}</span> hexes</ReviewSummary>
      <div className="ar-board">
        <div className="hm-board" aria-hidden="true">
          {review.rows.map((row, r) => (
            <div key={r} className={`hm-row${r % 2 === 1 ? " is-indent" : ""}`}>
              {row.map((h) => (
                <div key={h.id} className={`hm-hex${h.claimedBy ? " is-claimed" : ""}`}>
                  <span className="hm-hex-label">
                    {h.type === "team" ? <TeamNameGradient name={teamNickname(h.label)} surface="hex" /> : h.label}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <ol className="ar-rounds">
        {all.map((h, i) => (
          <ReviewRound
            key={h.id}
            no={i + 1}
            ok={!!h.claimedBy}
            answer={<span>{h.label}</span>}
            pick={h.claimedBy
              ? <ReviewPick pick={h.claimedBy} ok verb="You named" />
              : <span className="ar-pick">{h.example ? <>A fit: <b>{h.example}</b></> : "No player fits every neighbour"}</span>}
          />
        ))}
      </ol>
    </>
  );
}

/** Connections: all four groups as the game's tier bars; the ones you missed are outlined. */
export function ConnectionsReview({ review }: { review: Of<"connections"> }) {
  const solved = review.groups.filter((g) => g.solved).length;
  const groups = [...review.groups].sort((a, b) => a.difficulty - b.difficulty);
  return (
    <>
      <ReviewSummary>You found <b className="tnum">{solved}</b> of <span className="tnum">{review.groups.length}</span> groups</ReviewSummary>
      <div className="cn-solved">
        {groups.map((g) => (
          <div
            key={g.label}
            className={`cn-solved-bar${g.solved ? "" : " is-missed"}`}
            style={{ ["--tier" as string]: TIER_COLOR[g.difficulty], ["--tier-ink" as string]: TIER_INK[g.difficulty] }}
          >
            <span className="cn-solved-label font-display">{g.label}</span>
            <span className="cn-solved-members">{g.members.join(" · ")}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Immaculate Grid: your picks, and a known answer in every cell you missed. */
export function NbaGridReview({ review }: { review: Of<"nba-grid"> }) {
  const solved = review.cells.filter((c) => c.pick).length;
  return (
    <>
      <ReviewSummary>You filled <b className="tnum">{solved}</b> of <span className="tnum">9</span> cells</ReviewSummary>
      <div className="ng-board" role="grid" aria-label="Your grid with answers">
        <div className="ng-corner" aria-hidden="true" />
        {review.cols.map((c, i) => <div key={`c${i}`} className="ng-head-cell ng-col-head">{c}</div>)}
        {review.rows.map((rowLabel, r) => (
          <div key={`r${r}`} className="ng-board-row" style={{ display: "contents" }}>
            <div className="ng-head-cell ng-row-head">{rowLabel}</div>
            {[0, 1, 2].map((c) => {
              const cell = review.cells[r * 3 + c];
              return (
                <div
                  key={c}
                  role="gridcell"
                  className={`ng-cell${cell.pick ? " is-solved" : " is-missed"}`}
                  aria-label={`${rowLabel} and ${review.cols[c]}: ${cell.pick ?? (cell.examples[0] ? `e.g. ${cell.examples[0]}` : "no answer")}`}
                >
                  {cell.pick ? (
                    <>{CHECK}<span className="ng-cell-name">{cell.pick}</span></>
                  ) : (
                    <span className="ar-example">{cell.examples[0] ? `e.g. ${cell.examples[0]}` : "—"}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** Bingo: your card, each dab, and a player who fit every square you left open. */
export function BingoReview({ review }: { review: Of<"bingo"> }) {
  const dabbed = review.cells.filter((c) => c.claimedBy).length;
  return (
    <>
      <ReviewSummary>You dabbed <b className="tnum">{dabbed}</b> of <span className="tnum">{review.cells.length}</span> squares</ReviewSummary>
      <div className="bng-grid" role="grid" aria-label="Your card with answers">
        {review.cells.map((c, i) => (
          <div key={i} role="gridcell" className={`bng-cell${c.claimedBy ? " is-claimed" : ""}`}>
            <span className="bng-cell-label">{c.label}</span>
            {c.claimedBy
              ? <span className="bng-cell-claimer">{c.claimedBy}</span>
              : c.example && <span className="bng-cell-claimer ar-example">e.g. {c.example}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

/** NBA Tic-Tac-Toe: the final duel board (your cells and theirs). */
export function TicTacToeReview({ review }: { review: Of<"tictactoe"> }) {
  const result = review.result === "draw" ? "It ended in a draw" : review.result === "win" ? "You won the board" : "Your opponent won the board";
  return (
    <>
      <ReviewSummary><b>{result}</b> · you hold <span className="tnum">{review.cells.filter((c) => c.mine).length}</span> of <span className="tnum">9</span></ReviewSummary>
      <div className="ttt-board">
        <TttBoard
          ariaLabel="Final board"
          rows={review.rows}
          cols={review.cols}
          cell={(i) => {
            const c = review.cells[i];
            return { name: c?.name, mine: !!c?.mine, theirs: !!c?.name && !c.mine, disabled: true };
          }}
          selectedCell={null}
          onSelect={() => {}}
          animateClaim={false}
        />
      </div>
    </>
  );
}

/** Career Path: the player, then his whole career face up, then your guesses. */
export function CareerPathReview({ review }: { review: Of<"career-path"> }) {
  const last = review.teams.length - 1;
  return (
    <>
      <ReviewSummary>
        {review.won ? <>Named on guess <b className="tnum">{review.guesses.length}</b></> : <>Not named in <span className="tnum">{review.guesses.length}</span> guesses</>}
      </ReviewSummary>
      <div className="cp-answer">
        <div className="cp-answer-photo"><RevealHeadshot personId={review.player.person_id} name={review.player.full_name} /></div>
        <div className="cp-answer-text">
          <span className="cp-reveal-label">The journey belonged to</span>
          <span className="cp-reveal-name font-display">{review.player.full_name}</span>
        </div>
      </div>
      <div className="cp-rail" role="list" aria-label="Career stops">
        {review.teams.map((stint, i) => (
          <div key={i} className="cp-card" role="listitem">
            <div className="cp-flip is-flipped">
              <div className="cp-face cp-face--back" aria-hidden="true" />
              <div className="cp-face cp-face--front">
                <span className="cp-card-years tnum">{stintYears(stint)}</span>
                <TeamBadge name={stint.name} abbr={null} surface="card" className="cp-card-logo" decorative />
                <span className="cp-card-team font-display">{stint.name}</span>
                <div className="cp-card-stats">
                  <span className="cp-stat"><b className="tnum">{stint.gp ?? "—"}</b> GP</span>
                  <span className="cp-stat"><b className="tnum">{stint.ppg != null ? stint.ppg.toFixed(1) : "—"}</b> PPG</span>
                </div>
                <span className={`cp-card-draft tnum${i === last ? "" : " is-hidden"}`}>{review.draft}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <GuessChips guesses={review.guesses} winner={review.won ? review.guesses[review.guesses.length - 1] : null} />
    </>
  );
}

function GuessChips({ guesses, winner }: { guesses: string[]; winner: string | null }) {
  if (!guesses.length) return null;
  return (
    <>
      <p className="ar-sub">Your guesses</p>
      <div className="ar-chips">
        {guesses.map((g, i) => <span key={i} className={`ar-chip${g === winner ? " is-good" : ""}`}>{g}</span>)}
      </div>
    </>
  );
}

/** Who Are Ya: the reveal card and every guess with its clue chips, newest first. */
export function WhoAreYaReview({ review }: { review: Of<"who-are-ya"> }) {
  return (
    <>
      <ReviewSummary>
        {review.won ? <>Found in <b className="tnum">{review.rows.length}</b></> : <>Not found in <span className="tnum">{review.rows.length}</span> guesses</>}
      </ReviewSummary>
      <div className="ar-board">
        <PlayerPhoto personId={review.mystery.person_id} alt={review.mystery.full_name} className="cp-reveal-photo" fallbackClassName="cp-reveal-fallback" />
        <div className={`waya-reveal${review.won ? " is-won" : ""}`} style={{ width: "100%" }}>
          <span className="waya-reveal-name font-display">{review.mystery.full_name}</span>
          <span className="waya-reveal-sub tnum">{review.mystery.sub}</span>
        </div>
        {review.rows.length > 0 && (
          <div className="waya-feed" role="list" aria-label="Your guesses">
            {review.rows.map((r) => (
              <div key={r.key} role="listitem" className={`waya-row${r.correct ? " is-correct" : ""}`}><WayaRowBody row={r} /></div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** LeContexto: the secret player as the #1 card, then your guesses by rank. */
export function ContextoReview({ review }: { review: Of<"contexto"> }) {
  const bar = (rank: number) =>
    `${Math.max(5, Math.round(100 * (1 - (rank - 1) / Math.max(1, review.poolSize - 1))))}%`;
  return (
    <>
      <ReviewSummary>
        {review.won ? <>Found in <b className="tnum">{review.rows.length}</b> guesses</> : <>Gave up after <span className="tnum">{review.rows.length}</span> guesses</>}
      </ReviewSummary>
      <div className={`cx-reveal ${review.won ? "is-good" : "is-brand"}`}>
        <span className="cx-reveal-photo"><PlayerPhoto personId={review.secret.person_id} alt={review.secret.full_name} frame="avatar" /></span>
        <span className="cx-reveal-text">
          <span className="cx-reveal-label">The secret player</span>
          <span className="cx-row-name font-display">{review.secret.full_name}</span>
        </span>
        <span className="cx-row-rank tnum">#1</span>
      </div>
      {review.rows.length > 0 && (
        <div className="cx-list" role="list" aria-label="Your guesses">
          {review.rows.map((r) => (
            <div key={r.pid} role="listitem" className={`cx-row is-${rankColor(r.rank)}${r.rank === 1 ? " is-win" : ""}`}>
              <span className="cx-row-name font-display">{r.name}</span>
              <span className="cx-bar-track"><span className="cx-bar-fill" style={{ width: bar(r.rank) }} /></span>
              <span className="cx-row-rank tnum">#{r.rank}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** NBA Imposter: the mystery player, the game's own reveal and scoreboard, and every clue. */
export function ImposterReview({ review }: { review: Of<"imposter"> }) {
  return (
    <>
      <ReviewSummary>The mystery player was <b>{review.mystery}</b></ReviewSummary>
      <ImposterReveal
        imposterName={review.imposterName}
        imposterGuess={review.imposterGuess}
        guessCorrect={review.guessCorrect}
        seats={review.seats}
      />
      <p className="ar-sub">Clues</p>
      <ul className="ar-clues">
        {review.seats.map((s) => (
          <li key={s.uid} className="ar-clue"><b>{s.name}</b><span>{s.clues.length ? s.clues.join(" · ") : "No clue"}</span></li>
        ))}
      </ul>
    </>
  );
}
