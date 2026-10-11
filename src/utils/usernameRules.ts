import type { PasswordRule } from "./passwordRules";
import type { NameVerdict } from "./nameCheck";

const NAME_ALLOWED_LABEL = "Not reserved or offensive";

/** The username rules, mirroring backend USERNAME_RE (3-20 letters, numbers or underscores) and the
 *  server's moderation check (check-name/). Names don't have to be unique, so there is no
 *  availability rule. The moderation rule waits ("pending") until the format passes and the
 *  server has answered for this exact value; a refusal shows the server's generic message. */
export function usernameRules(name: string, verdict: NameVerdict | null): PasswordRule[] {
  const length = name.length >= 3 && name.length <= 20;
  const chars = name.length > 0 && /^[A-Za-z0-9_]*$/.test(name);
  const status = verdict?.status ?? "checking";
  return [
    { key: "length", label: "3 to 20 characters", ok: length },
    { key: "chars", label: "Only letters, numbers and underscores", ok: chars },
    {
      key: "allowed",
      label: status === "bad" && verdict?.error ? verdict.error : NAME_ALLOWED_LABEL,
      ok: status === "ok",
      pending: status === "checking",
    },
  ];
}
