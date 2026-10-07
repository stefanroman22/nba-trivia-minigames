export interface ConsentValue {
  month: string;
  year: string;
  agreed: boolean;
}

export const EMPTY_CONSENT: ConsentValue = { month: "", year: "", agreed: false };

/** What a sign-up request sends for the consent step. */
export const consentPayload = (value: ConsentValue) => ({
  accepted_terms: value.agreed,
  birth_year: Number(value.year),
  birth_month: Number(value.month),
});

export const consentComplete = (value: ConsentValue) => value.agreed && value.month !== "" && value.year !== "";

const BLOCK_KEY = "swq-signup-blocked-until";
const BLOCK_MS = 24 * 60 * 60 * 1000;

/** After a failed age check, stop the same browser retrying with another date for a day. A
 *  courtesy for honest users, not a security control (anyone can clear storage). */
export function ageBlockActive(): boolean {
  try {
    return Number(localStorage.getItem(BLOCK_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

export function startAgeBlock(): void {
  try {
    localStorage.setItem(BLOCK_KEY, String(Date.now() + BLOCK_MS));
  } catch {
    /* storage unavailable: the server still enforces the age check */
  }
}
