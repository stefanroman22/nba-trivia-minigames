import { useState } from "react";
import { useSelector } from "react-redux";
import type { Variants } from "framer-motion";
import type { RootState } from "../store";
import { useReducedMotionSafe } from "./useReducedMotionSafe";
import { fadeIn, reducedFade } from "../motion/variants";

/**
 * Motion props for signed-in UI that should fade in on a fresh login — the user goes null -> set
 * after the session check had already settled (a form/Google login) — but never on a cold load of
 * an existing session (restore/check: `authChecked` was still false) or on a route change (the
 * caller mounts with the user already set). Call it in a component that is mounted BEFORE the
 * login (e.g. Navigation, the page view) and spread the result on the motion element that mounts
 * with the user. Reduced motion: a short opacity fade.
 */
export function useLoginReveal(): { variants: Variants; initial: "hidden" | false; animate: "visible" } {
  const { user, authChecked } = useSelector((state: RootState) => state.user);
  const reduce = useReducedMotionSafe();
  const signedIn = !!user;
  const [prev, setPrev] = useState({ signedIn, authChecked });
  const [fresh, setFresh] = useState(false);
  if (prev.signedIn !== signedIn || prev.authChecked !== authChecked) {
    setPrev({ signedIn, authChecked });
    setFresh(signedIn && !prev.signedIn && prev.authChecked);
  }
  return { variants: reduce ? reducedFade : fadeIn, initial: fresh ? "hidden" : false, animate: "visible" };
}
