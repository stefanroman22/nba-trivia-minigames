import { AnimatePresence, motion } from "framer-motion";
import SwapText from "./motion/SwapText";
import { nameNoteSlot } from "../utils/nameCheck";
import type { PasswordRule } from "../utils/passwordRules";

type RuleState = "ok" | "bad" | "pending";

function RuleIcon({ state }: { state: RuleState }) {
  return (
    <SwapText swapKey={state} className="pw-rule-icon">
      {state === "ok" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : state === "bad" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M7 12h10" /></svg>
      )}
    </SwapText>
  );
}

/** Live checklist under the sign-up password field and the username fields (sign-up, profile
 *  settings): glides open once the player starts typing (the shared name-note slot animation), and
 *  each rule flips between a red cross and a green check (a neutral dash while a server check runs). */
export default function PasswordRules({
  show,
  rules,
  label = "Password requirements",
}: {
  show: boolean;
  rules: PasswordRule[];
  label?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div key="pw-rules" style={{ overflow: "hidden" }} variants={nameNoteSlot} initial="hidden" animate="visible" exit="hidden">
          <ul className="pw-rules" aria-label={label}>
            {rules.map((r) => {
              const state: RuleState = r.ok ? "ok" : r.pending ? "pending" : "bad";
              return (
                <li key={r.key} className={`pw-rule is-${state}`}>
                  <RuleIcon state={state} />
                  <SwapText>{r.label}</SwapText>
                  <span className="pw-sr">{state === "ok" ? "(met)" : state === "pending" ? "(checking)" : "(not met)"}</span>
                </li>
              );
            })}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
