// Answer reviews for the round-by-round games: every round with its right answer and your pick.
import TeamCrest from "../ui/TeamCrest";
import { Headshot } from "../../Game Renderers/SuperDraft";
import { ReviewPick, ReviewRound, ReviewSummary } from "./ReviewParts";
import type { AnswerReview } from "../../types/review";

type Of<G extends AnswerReview["game"]> = Extract<AnswerReview, { game: G }>;

const rightCount = (rows: { correct: boolean }[]) => rows.filter((r) => r.correct).length;

function RoundTally({ right, total }: { right: number; total: number }) {
  return <ReviewSummary><b className="tnum">{right}</b> of <span className="tnum">{total}</span> right</ReviewSummary>;
}

/** Guess the Series Winner: both teams per series, the winner green, a wrong pick red. */
export function SeriesReview({ review }: { review: Of<"series-winner"> }) {
  const right = review.rounds.filter((r) => r.pick === r.winner).length;
  return (
    <>
      <RoundTally right={right} total={review.rounds.length} />
      <ol className="ar-rounds">
        {review.rounds.map((r, i) => {
          const ok = r.pick === r.winner;
          return (
            <ReviewRound
              key={i}
              no={i + 1}
              label={r.label}
              ok={ok}
              answer={
                <div className="ar-teams">
                  {r.teams.map((t) => (
                    <span
                      key={t.name}
                      className={`ar-team${t.name === r.winner ? " is-winner" : t.name === r.pick ? " is-wrong" : ""}`}
                    >
                      <TeamCrest src={t.logo} name={t.name} size={20} />
                      <span className="ar-team-name">{t.name}</span>
                      <span className="tnum">{t.wins}</span>
                    </span>
                  ))}
                </div>
              }
              pick={<ReviewPick pick={r.pick} ok={ok} verb="You picked" />}
            />
          );
        })}
      </ol>
    </>
  );
}

/** Name the NBA Club: each logo with the franchise it belongs to. */
export function LogoReview({ review }: { review: Of<"name-logo"> }) {
  return (
    <>
      <RoundTally right={rightCount(review.rounds)} total={review.rounds.length} />
      <ol className="ar-rounds">
        {review.rounds.map((r, i) => (
          <ReviewRound
            key={i}
            no={i + 1}
            ok={r.correct}
            answer={<><TeamCrest src={r.logo} name={r.team} size={32} /><span>{r.team}</span></>}
            pick={<ReviewPick pick={r.pick} ok={r.correct} />}
          />
        ))}
      </ol>
    </>
  );
}

/** Guess the MVP: each season with its MVP. */
export function MvpReview({ review }: { review: Of<"guess-mvps"> }) {
  return (
    <>
      <RoundTally right={rightCount(review.rounds)} total={review.rounds.length} />
      <ol className="ar-rounds">
        {review.rounds.map((r, i) => (
          <ReviewRound
            key={i}
            no={i + 1}
            label={<span className="tnum">{r.season}</span>}
            ok={r.correct}
            answer={<span>{r.mvp}</span>}
            pick={<ReviewPick pick={r.pick} ok={r.correct} />}
          />
        ))}
      </ol>
    </>
  );
}

/** Pack 5: every bet, your card's stat against the next card's. */
export function PackFiveReview({ review }: { review: Of<"pack-five"> }) {
  return (
    <>
      <RoundTally right={review.turns.filter((t) => t.hit).length} total={review.turns.length} />
      <ol className="ar-rounds">
        {review.turns.map((t, i) => (
          <ReviewRound
            key={i}
            no={i + 1}
            label={`You bet ${t.stat}`}
            ok={t.hit}
            answer={<span>{t.card.name} <span className="tnum">{t.card.value}</span></span>}
            pick={<span className={`ar-pick ${t.hit ? "is-good" : "is-bad"}`}>vs {t.next.name} <b className="tnum">{t.next.value}</b></span>}
          />
        ))}
      </ol>
    </>
  );
}

/** SuperDraft Five: the drafted slots (the game's own slot cards) with each pool's best pick. */
export function SuperDraftReview({ review }: { review: Of<"superdraft"> }) {
  return (
    <>
      <ReviewSummary>
        <b>{review.objective}</b> · {review.aggLabel} <b className="tnum">{review.aggregate}</b> · beats <span className="tnum">{review.percentile}%</span> of random lineups
      </ReviewSummary>
      <ul className="sd-slots">
        {review.slots.map((s, i) => (
          <li key={i} className={`sd-slot${s.pick ? " is-filled" : ""}`}>
            <span className="sd-slot-no tnum" aria-hidden="true">{i + 1}</span>
            <div className="sd-slot-body">
              <div className="sd-slot-head">
                <span className="sd-slot-label font-display">{s.label}</span>
                <span className={`sd-slot-sub sd-slot-sub--${s.kind}`}>{s.sub}</span>
              </div>
              <span className="sd-slot-pick font-display">{s.pick ? s.pick.name : "Empty"}</span>
              {s.best && s.best.person_id !== s.pick?.person_id && (
                <span className="ar-best">Best pick: <b>{s.best.name}</b> <span className="tnum">({s.best.metric})</span></span>
              )}
            </div>
            <div className="sd-slot-right">
              {s.pick && <div className="sd-slot-face"><Headshot player={s.pick} /></div>}
              {s.pick && <span className="sd-slot-metric tnum">{s.pick.metric}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
