// "Why?" under a missed round of an answer review (Series Winner, Guess the MVP): a disclosure that fetches the
// backend's short AI explanation on the first open and reuses it afterwards (utils/explain.ts keeps the cache).
// Renders nothing, and so makes no request, unless EXPLANATIONS_ENABLED is on.
import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import AutoHeight from "../motion/AutoHeight";
import { fadeIn } from "../../motion/variants";
import { EXPLANATIONS_ENABLED } from "../../configurations/backend";
import { cachedExplanation, fetchExplanation, type ExplainGame } from "../../utils/explain";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; text: string } | { kind: "none" };

function initialState(game: ExplainGame, qid: string): State {
  const known = cachedExplanation(game, qid);
  if (known === undefined) return { kind: "idle" };
  return known ? { kind: "ready", text: known.text } : { kind: "none" };
}

function Disclosure({ game, qid }: { game: ExplainGame; qid: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(() => initialState(game, qid));
  const regionId = useId();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state.kind === "idle") {
      setState({ kind: "loading" });
      void fetchExplanation(game, qid).then((found) => setState(found ? { kind: "ready", text: found.text } : { kind: "none" }));
    }
  }

  return (
    <div className="ar-why">
      <button type="button" className="ar-why-btn" aria-expanded={open} aria-controls={regionId} onClick={toggle}>
        Why?
        <svg className="ar-why-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <AutoHeight>
        <div id={regionId} className="ar-why-region" aria-live="polite">
          <AnimatePresence initial={false} mode="wait">
            {open && (
              <motion.div key={state.kind} className="ar-why-body" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                {state.kind === "ready" ? (
                  <>
                    <p className="ar-why-text">{state.text}</p>
                    <p className="ar-why-note">Written by AI from our data.</p>
                  </>
                ) : state.kind === "none" ? (
                  <p className="ar-why-text is-quiet">No explanation available for this one.</p>
                ) : (
                  <p className="ar-why-text is-quiet">Looking it up…</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </AutoHeight>
    </div>
  );
}

export default function ExplainWhy({ game, qid }: { game: ExplainGame; qid: string }) {
  if (!EXPLANATIONS_ENABLED) return null;
  return <Disclosure game={game} qid={qid} />;
}
