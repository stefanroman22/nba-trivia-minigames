import { createContext } from "react";

/**
 * The shell-owned DOM node (in `.playing-wrap`, positioned in the gap just above
 * the Exit button) that game feedback popups portal into. Set by MiniGame; read
 * by SubmitGuessPopup. `null` before the slot mounts (popup falls back inline).
 * This is what makes the "Correct! +10" line appear in one consistent spot —
 * between the game's submission and Exit — for every game.
 */
export const FeedbackSlotContext = createContext<HTMLElement | null>(null);
