// Shared motion design tokens — keeps every animation on the same rhythm.
import type { Transition } from "framer-motion";

export const durations = {
  fast: 0.18,
  base: 0.28,
  slow: 0.42,
} as const;

// ease-out for entrances, ease-in for exits (see UX motion guidelines)
export const easing = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  in: [0.64, 0, 0.78, 0] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

export const springs: Record<string, Transition> = {
  soft: { type: "spring", stiffness: 260, damping: 26 },
  pop: { type: "spring", stiffness: 420, damping: 18, mass: 0.6 },
  gentle: { type: "spring", stiffness: 120, damping: 18 },
};
