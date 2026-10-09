export interface PasswordRule { key: string; label: string; ok: boolean }

/** True when one value contains the other (3+ characters, case-insensitive): a cheap stand-in for
 *  Django's UserAttributeSimilarityValidator, which the server still runs on submit. */
const overlaps = (pw: string, attr: string) => {
  const a = attr.trim().toLowerCase();
  const p = pw.toLowerCase();
  return a.length >= 3 && p.length >= 3 && (p.includes(a) || a.includes(p));
};

/** The sign-up password rules, mirroring backend AUTH_PASSWORD_VALIDATORS (min length 8, not all
 *  numbers, not like the username/email). "Too common" can only be checked by the server; its
 *  message comes back explicitly on submit. */
export function passwordRules(password: string, username: string, email: string): PasswordRule[] {
  const emailName = email.split("@")[0] || "";
  return [
    { key: "length", label: "At least 8 characters", ok: password.length >= 8 },
    { key: "numeric", label: "Not only numbers", ok: password.length > 0 && !/^\d+$/.test(password) },
    {
      key: "similar",
      label: "Not like your username or email",
      ok: password.length > 0 && !overlaps(password, username) && !overlaps(password, emailName) && !overlaps(password, email),
    },
  ];
}
