import { useReducedMotion } from "framer-motion";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * framer-motion's `useReducedMotion`, made safe for server rendering.
 *
 * The original returns `null` on the server but the real preference during
 * hydration, so any markup derived from it (an `initial` prop, an inline
 * `animation`) differs between the two for reduced-motion users. This returns
 * `null` until the component has hydrated, then framer's value — the first
 * client render matches the server, and the preference applies from the next.
 */
export function useReducedMotionSafe(): boolean | null {
  const reduce = useReducedMotion();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? reduce : null;
}
