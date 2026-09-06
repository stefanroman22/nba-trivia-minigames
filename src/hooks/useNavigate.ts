import { usePageTransition, type NavigateFn } from "../context/PageTransitionContext";

/**
 * Drop-in for react-router's `useNavigate()`: `navigate(path, { state })`.
 * Plays the page exit fade, then pushes the route (see PageTransitionContext).
 */
export function useNavigate(): NavigateFn {
  return usePageTransition().navigate;
}
