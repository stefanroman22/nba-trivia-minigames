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
