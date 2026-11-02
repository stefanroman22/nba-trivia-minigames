import { useEffect, useRef, type RefObject } from "react";

/** Below this width the Multiplayer card is stacked under the stage (MiniGame.css), so the room's
 *  tall lobby / match card and the stage both sit above the footer. Keep in step with the 820px
 *  breakpoint there. */
const STACKED_QUERY = "(max-width: 819px)";

/**
 * Keeps the stacked game page from getting shorter when a room or match ends on its own (the host
 * closed it, the opponent left): the shrink would carry the footer up by hundreds of px, and a
 * remote event has no input of the player's own to excuse the shift (CLS, UI-23).
 *
 * While `active` (a room or match is open) the grid's tallest height is remembered; once it ends
 * the grid keeps that min-height, and the gap is given back on the player's next click or key press,
 * gliding down to the content height over 0.3 s (`.game-grid` transition) inside that input's own
 * window. Phones/tablets below 820px only; the desktop layouts do not stack.
 */
export function useHoldHeightAfterRoom(gridRef: RefObject<HTMLElement | null>, active: boolean) {
  const heldRef = useRef(0);

  // Remember the tallest the grid gets while the room is open (it grows with the lobby/match card).
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !active) return;
    const mq = window.matchMedia(STACKED_QUERY);
    if (!mq.matches) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > heldRef.current) {
        heldRef.current = h;
        el.style.minHeight = `${h}px`;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridRef, active]);

  // Room over: wait for the player's next tap or key press, then release. Armed only after `active`
  // turned off, so the very click that closes the room (already past) does not release it too early.
  useEffect(() => {
    const el = gridRef.current;
    if (active || !el || heldRef.current === 0) return;
    const mq = window.matchMedia(STACKED_QUERY);
    let timer = 0;
    const clear = () => {
      window.clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      heldRef.current = 0;
      el.style.minHeight = "";
    };
    // Landing on the content height clears the pin with no visible change.
    const onEnd = (e: TransitionEvent) => { if (e.target === el && e.propertyName === "min-height") clear(); };
    const release = (e: Event) => {
      // A press on the footer is a tap on a link or button: do not move it from under the finger.
      if (e.target instanceof Element && e.target.closest(".site-footer")) return;
      stopListening();
      // Glide toward where the content actually ends (grid top to the last child's bottom, rows are
      // packed at the start), not to 0: easing down to 0 would spend most of its 0.3 s below the
      // content height, where nothing moves, and the visible part would be a jump.
      const last = el.lastElementChild;
      const content = last ? Math.ceil(last.getBoundingClientRect().bottom - el.getBoundingClientRect().top) : 0;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || content <= 0 || content >= heldRef.current - 1) return clear();
      el.addEventListener("transitionend", onEnd);
      timer = window.setTimeout(clear, 450); // fallback if the transition never reports an end
      el.style.minHeight = `${content}px`; // the 0.3 s glide is the CSS transition (durations.slow, --ease-out)
    };
    // Widening past the breakpoint un-stacks the layout: nothing to hold any more.
    const onChange = () => { if (!mq.matches) { stopListening(); clear(); } };
    // `click`, not `pointerdown`: releasing on the press would move the content (the scroll position
    // clamps as the page shortens) between pointerdown and pointerup and could lose the tap.
    const stopListening = () => {
      document.removeEventListener("click", release, true);
      document.removeEventListener("keydown", release, true);
      mq.removeEventListener("change", onChange);
    };
    document.addEventListener("click", release, true);
    document.addEventListener("keydown", release, true);
    mq.addEventListener("change", onChange);
    return () => { stopListening(); window.clearTimeout(timer); el.removeEventListener("transitionend", onEnd); };
  }, [gridRef, active]);
}
