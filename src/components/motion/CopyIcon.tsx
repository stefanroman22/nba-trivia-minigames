import SwapText from "./SwapText";

/** The copy glyph that swaps to a check once something is on the clipboard (via the shared SwapText
 *  swap, UI-21). The one copy-feedback icon: room codes (FriendPlay) and the player ID (UserProfile). */
export default function CopyIcon({ copied, className }: { copied: boolean; className?: string }) {
  return (
    <SwapText swapKey={copied ? "copied" : "copy"} className={className}>
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </SwapText>
  );
}
