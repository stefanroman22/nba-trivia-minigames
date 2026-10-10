import { AnimatePresence, motion } from "framer-motion";
import SwapText from "./motion/SwapText";
import { nameNoteSlot } from "../utils/nameCheck";
import type { PasswordRule } from "../utils/passwordRules";

function RuleIcon({ ok }: { ok: boolean }) {
  return (
    <SwapText swapKey={ok ? "ok" : "bad"} className="pw-rule-icon">
      {ok ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      )}
    </SwapText>
  );
}

/** Live checklist under the sign-up password field: glides open once the player starts typing
 *  (the shared name-note slot animation), and each rule flips between a red cross and a green check. */
export default function PasswordRules({ show, rules }: { show: boolean; rules: PasswordRule[] }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div key="pw-rules" style={{ overflow: "hidden" }} variants={nameNoteSlot} initial="hidden" animate="visible" exit="hidden">
          <ul className="pw-rules" aria-label="Password requirements">
            {rules.map((r) => (
              <li key={r.key} className={`pw-rule${r.ok ? " is-ok" : ""}`}>
                <RuleIcon ok={r.ok} />
                <span>{r.label}</span>
                <span className="pw-sr">{r.ok ? "(met)" : "(not met)"}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
