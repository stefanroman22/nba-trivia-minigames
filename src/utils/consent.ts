/** What a sign-up request (email, or Google for a new account) sends for the one tick-box,
 *  "I'm 13 or older and agree to the Terms of Service and Privacy Policy". */
export const consentPayload = (agreed: boolean) => ({ accepted_terms: agreed, age_confirmed: agreed });

export const CONSENT_NEEDED = "Please confirm you're 13 or older and agree to the Terms and Privacy Policy.";
