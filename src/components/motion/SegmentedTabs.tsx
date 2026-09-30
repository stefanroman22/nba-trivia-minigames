// Tab/pill switcher with an animated "thumb" that slides to the active option
// (framer-motion shared-layout `layoutId`). The one place every single-track
// switcher in the app gets its motion from, so they all move on the same
// spring (`springs.thumb` in motion/tokens). Each caller keeps its own track
// and button classes for sizing/shape; the thumb fill and label layering come
// from SegmentedTabs.css. Respects reduced motion.
import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { springs } from "../../motion/tokens";
import { useRovingTabs } from "../../hooks/useRovingTabs";
import "../../styles/SegmentedTabs.css";

export interface SegmentedTabsOption<T extends string> {
  key: T;
  label: ReactNode;
}

interface SegmentedTabsProps<T extends string> {
  options: readonly SegmentedTabsOption<T>[];
  value: T;
  onChange: (key: T) => void;
  /** Track (container) class, e.g. "fr-tabs". */
  className: string;
  /** Per-option button class, e.g. "fr-tab"; the active one also gets "is-active". */
  itemClassName: string;
  /** Thumb corner radius — match the button's own border-radius. Set here (not
      only in CSS) so framer-motion can scale-correct it while the thumb resizes. */
  thumbRadius?: number | string;
  "aria-label"?: string;
}

export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  className,
  itemClassName,
  thumbRadius = 999,
  "aria-label": ariaLabel,
}: SegmentedTabsProps<T>) {
  const reduce = useReducedMotion();
  // Scoped per instance so two mounted switchers never trade thumbs.
  const layoutId = `seg-thumb-${useId()}`;
  const { onKeyDown, tabIndexFor } = useRovingTabs(options.map((o) => o.key), value, onChange);

  return (
    <div className={className} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            className={`${itemClassName} seg-item${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
            tabIndex={tabIndexFor(o.key)}
            onClick={() => onChange(o.key)}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="seg-thumb"
                style={{ borderRadius: thumbRadius }}
                transition={reduce ? { duration: 0 } : springs.thumb}
              />
            )}
            <span className="seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
