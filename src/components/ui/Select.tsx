"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import Chevron from "./Chevron";
import SwapText from "../motion/SwapText";
import { useReducedMotionSafe } from "../../hooks/useReducedMotionSafe";
import { durations, easing } from "../../motion/tokens";
import { reducedFade } from "../../motion/variants";
import "../../styles/Select.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectBaseProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown (muted) while `value` matches no option, e.g. "Birth year". Not an option itself. */
  placeholder?: string;
  disabled?: boolean;
  /** Skin for the trigger (`modal-input`, `fb-select`, …); without one it takes the `.field` look. */
  className?: string;
}
/** A combobox needs a name: an `aria-label`, or the id of a visible label in `aria-labelledby`. */
type SelectProps = SelectBaseProps &
  ({ "aria-label": string; "aria-labelledby"?: string } | { "aria-label"?: string; "aria-labelledby": string });

type Side = "below" | "above";
interface Placement {
  side: Side;
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
  fontSize: string;
}

// Must match Select.css: option row height, menu padding and border. Every row is one line, so the
// menu's height is known before it mounts and the side it opens on never changes after the first frame.
const ROW = 36;
const PAD = 4;
const BORDER = 1;
const MAX_HEIGHT = ROW * 8 + PAD * 2 + BORDER * 2;
const GAP = 6; // trigger ↔ menu
const EDGE = 8; // menu ↔ viewport edge

const subscribe = () => () => {};

/** Bottom of the sticky site header (`.nav3`) when it covers the top of the viewport, else 0. Inside a
 *  dialog the modal backdrop sits above the header, so that space is free. */
function headerBottom(trigger: HTMLElement) {
  if (trigger.closest('[role="dialog"]')) return 0;
  const nav = document.querySelector(".nav3");
  return nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
}

/** Swallow the click that follows an outside press which closed a menu, so closing never also
 *  presses what is under the pointer (as a native select). Disarms itself after 400 ms if no click comes. */
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    disarm();
  };
  const disarm = () => {
    window.removeEventListener("click", swallow, true);
    window.clearTimeout(timer);
  };
  window.addEventListener("click", swallow, true);
  const timer = window.setTimeout(disarm, 400);
}
const menuMotion = (dy: number): Variants => ({
  hidden: { opacity: 0, y: dy, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: durations.base, ease: easing.out } },
  exit: { opacity: 0, y: dy, scale: 0.97, transition: { duration: durations.base, ease: easing.inOut } },
});

/**
 * The app's one dropdown (UI_SHELL_CONSTRAINTS UI-24): never a native select element. A button
 * (`role="combobox"`) shows the value and a chevron that points right while closed and turns toward
 * the menu when it opens: down when the menu opens below, up when there is only room above. The
 * listbox renders in a portal (above modals, never clipped by a scrolling card), fades in from the
 * trigger side and fades out on close, and scrolls on its own when long. Focus stays on the button
 * (`aria-activedescendant`), so a modal's focus trap never fights it. Keyboard: Enter/Space/Arrows
 * open, Arrows/Home/End/PageUp/PageDown move, typing jumps ("19" → 1999), Enter/Space pick,
 * Escape closes (and only the menu, not a surrounding modal), Tab closes.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = "",
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className = "",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", timer: 0 });
  const reduce = useReducedMotionSafe();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  /** Where the menu goes: the side with room for it (keeping `keep` while it still fits), clamped to the viewport. */
  const measure = (keep?: Side): Placement | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const r = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const want = Math.min(MAX_HEIGHT, options.length * ROW + PAD * 2 + BORDER * 2);
    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE - headerBottom(trigger); // the sticky header's strip is not free space
    let side: Side;
    if (keep === "below" && below >= want) side = "below";
    else if (keep === "above" && above >= want) side = "above";
    else side = below >= want || below >= above ? "below" : "above";
    const maxHeight = Math.max(ROW + PAD * 2 + BORDER * 2, Math.min(MAX_HEIGHT, side === "below" ? below : above));
    const height = Math.min(want, maxHeight);
    const width = Math.max(r.width, listRef.current?.offsetWidth ?? 0);
    return {
      side,
      top: side === "below" ? r.bottom + GAP : r.top - GAP - height,
      left: Math.max(EDGE, Math.min(r.left, vw - width - EDGE)),
      minWidth: r.width,
      maxHeight,
      fontSize: getComputedStyle(trigger).fontSize,
    };
  };

  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i;
    return -1;
  };

  const openMenu = (at: number) => {
    if (disabled || options.length === 0) return;
    // Safari/iOS don't focus a pressed button: focus it so the keys and the blur-to-close work there too.
    triggerRef.current?.focus({ preventScroll: true });
    setPlace(measure());
    setActive(at >= 0 ? at : firstEnabled(0, 1));
    setOpen(true);
  };

  const close = () => setOpen(false);

  const choose = (i: number) => {
    const opt = options[i];
    if (!opt || opt.disabled) return;
    if (opt.value !== value) onChange(opt.value);
    close();
  };

  /** Type-ahead: the option whose label starts with what was typed in the last 600 ms ("2", "20", "200" → 2009…). */
  const typeahead = (ch: string, from: number) => {
    const t = typed.current;
    window.clearTimeout(t.timer);
    t.text += ch.toLowerCase();
    t.timer = window.setTimeout(() => { t.text = ""; }, 600);
    // One key pressed again and again cycles through the options starting with it (J → January, June, July).
    const repeat = t.text.length > 1 && [...t.text].every((c) => c === t.text[0]);
    const query = repeat ? t.text[0] : t.text;
    const start = t.text.length === 1 || repeat ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length;
      if (!options[i].disabled && options[i].label.toLowerCase().startsWith(query)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    const printable = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (k !== " " || typed.current.text !== "");

    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        openMenu(selectedIndex >= 0 ? selectedIndex : -1);
      } else if (k === "Home" || k === "End") {
        e.preventDefault();
        openMenu(k === "Home" ? firstEnabled(0, 1) : firstEnabled(options.length - 1, -1));
      } else if (printable) {
        const hit = typeahead(k, selectedIndex);
        openMenu(hit >= 0 ? hit : selectedIndex);
      }
      return;
    }

    if (k === "Escape") {
      // Close the menu only: React listens on the document, as does a modal's focus trap.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      close();
    } else if (k === "Tab") {
      close(); // no preventDefault: focus moves on as usual
    } else if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (k === "ArrowUp" && e.altKey) return choose(active);
      const next = k === "ArrowDown" ? firstEnabled(active + 1, 1) : firstEnabled(active - 1, -1);
      if (next >= 0) setActive(next);
    } else if (k === "Home" || k === "End") {
      e.preventDefault();
      setActive(k === "Home" ? firstEnabled(0, 1) : firstEnabled(options.length - 1, -1));
    } else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      const target = Math.max(0, Math.min(options.length - 1, active + (k === "PageDown" ? 8 : -8)));
      const next = k === "PageDown" ? firstEnabled(target, -1) : firstEnabled(target, 1);
      if (next >= 0) setActive(next);
    } else if (k === "Enter" || (k === " " && !printable)) {
      e.preventDefault();
      choose(active);
    } else if (printable) {
      e.preventDefault();
      const hit = typeahead(k, active);
      if (hit >= 0) setActive(hit);
    }
  };

  // On open: settle the placement with the menu's real width, and bring the selected option to the middle.
  useLayoutEffect(() => {
    if (!open) return;
    setPlace((p) => measure(p?.side));
    const list = listRef.current;
    if (list && active >= 0) list.scrollTop = Math.max(0, PAD + active * ROW - (list.clientHeight - ROW) / 2);
    // Only when it opens; `active` is the option it opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the keyboard-active option inside the menu's own scroll box (never scrolls the page).
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || active < 0) return;
    const top = PAD + active * ROW;
    if (top < list.scrollTop) list.scrollTop = top - PAD;
    else if (top + ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW + PAD - list.clientHeight;
  }, [open, active]);

  // While open: follow the trigger on scroll/resize (re-choosing the side, once per frame), close on an
  // outside press (swallowing its click) or when the trigger scrolls off screen or under the sticky header.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const follow = (e: Event) => {
      if (e.type === "scroll" && e.target === listRef.current) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const trigger = triggerRef.current;
        const r = trigger?.getBoundingClientRect();
        if (!trigger || !r || r.bottom < headerBottom(trigger) || r.top > document.documentElement.clientHeight) return close();
        setPlace((p) => measure(p?.side));
      });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
      swallowNextClick();
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
    // `measure` reads refs and the current options; re-binding per render is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A control that turns disabled while open (the form is saving) closes its menu.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  const side = place?.side ?? "below";
  const rotate = open ? (side === "below" ? 90 : -90) : 0;
  const variants = reduce ? reducedFade : menuMotion(side === "below" ? -6 : 6);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        className={`sel-trigger ${className || "field"}`}
        onClick={() => (open ? close() : openMenu(selectedIndex))}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
        onBlur={close}
      >
        <span className="sel-value">
          {/* Every label laid out invisibly in one grid cell: the trigger keeps the widest one's width, as a native select does. */}
          {[placeholder, ...options.map((o) => o.label)].map((label, i) => (
            <span key={i} className="sel-reserve" aria-hidden="true">{label}</span>
          ))}
          {/* The visible label animates (SwapText keeps the old one in the DOM for a moment), so screen
              readers read the always-current copy below instead. */}
          <span className={`sel-current${selected ? "" : " is-placeholder"}`} aria-hidden="true">
            <SwapText swapKey={selected ? `v:${selected.value}` : "placeholder"}>{selected ? selected.label : placeholder}</SwapText>
          </span>
        </span>
        <span className="sel-sr">{selected ? selected.label : placeholder}</span>
        <motion.span
          className="sel-chevron"
          aria-hidden="true"
          initial={false}
          animate={{ rotate }}
          transition={reduce ? { duration: 0 } : { duration: durations.base, ease: easing.out }}
        >
          <Chevron size={16} />
        </motion.span>
      </button>
      {hydrated &&
        createPortal(
          <AnimatePresence>
            {open && place && (
              <motion.ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                className="sel-menu"
                style={{
                  top: place.top,
                  left: place.left,
                  minWidth: place.minWidth,
                  maxHeight: place.maxHeight,
                  fontSize: place.fontSize,
                  transformOrigin: side === "below" ? "50% 0" : "50% 100%",
                }}
                variants={variants}
                initial="hidden"
                animate="visible"
                exit="exit"
                // Keep focus on the trigger when an option or the scrollbar is pressed.
                onMouseDown={(e) => e.preventDefault()}
              >
                {options.map((o, i) => (
                  <li
                    key={o.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === selectedIndex}
                    aria-disabled={o.disabled || undefined}
                    className={`sel-option${i === active ? " is-active" : ""}`}
                    onPointerMove={(e) => { if (e.pointerType === "mouse" && !o.disabled && i !== active) setActive(i); }}
                    onClick={() => choose(i)}
                  >
                    <span className="sel-option-label">{o.label}</span>
                    {i === selectedIndex && (
                      <svg className="sel-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
