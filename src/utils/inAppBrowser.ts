/** True for the embedded browsers inside social apps (Instagram, Facebook, TikTok, LinkedIn,
 *  Snapchat, Line…). Google refuses OAuth there ("disallowed_useragent"), so "Continue with
 *  Google" can only fail — the login form points the player at their real browser instead. */
export function isInAppBrowser(userAgent: string): boolean {
  return /(FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Bytedance|LinkedInApp|Snapchat|Line\/|MicroMessenger|Pinterest|Twitter)/i.test(userAgent);
}
