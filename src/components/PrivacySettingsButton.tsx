"use client";

/** Footer control that reopens Google's privacy message (its consent "revocation" message), so a visitor can
 *  change their ad and cookie choice at any time. SiteFooter renders it only when ads are switched on. */
export default function PrivacySettingsButton() {
  const open = () => {
    // Google's documented call; a closure so it also works when the message script loads after the click.
    window.googlefc?.callbackQueue?.push(() => window.googlefc?.showRevocationMessage?.());
  };
  return (
    <button type="button" className="site-footer-btn" onClick={open}>
      Privacy and cookie settings
    </button>
  );
}
