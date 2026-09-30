import { useEffect, type RefObject } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog keyboard behaviour: moves focus into `ref` on activation, wraps Tab /
 * Shift+Tab inside it, calls `onClose` on Escape, optionally locks background
 * scroll, and restores focus to the previously focused element on cleanup.
 * `onClose` must be referentially stable (it is an effect dependency).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { active = true, lockScroll = true }: { active?: boolean; lockScroll?: boolean } = {},
) {
  useEffect(() => {
    if (!active) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const panel = ref.current;

    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
        : [];

    // Move focus into the dialog (first focusable, else the panel itself).
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (activeEl === first || activeEl === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    let prevOverflow: string | undefined;
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      if (lockScroll) document.body.style.overflow = prevOverflow ?? "";
      prevFocus?.focus?.();
    };
  }, [ref, onClose, active, lockScroll]);
}
