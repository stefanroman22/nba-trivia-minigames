import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe } from "../../hooks/useReducedMotionSafe";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

type AutoSizeProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  duration?: number;
};

/**
 * A box that never jumps: it measures its content (ResizeObserver) and animates its own size to
 * match whenever the content changes — tab switches, async loads, expanding sections, a label
 * swap that changes a chip's width. The one primitive for this (UI rule UI-23 in
 * docs/constraints/UI_SHELL_CONSTRAINTS.md "Containers resize smoothly"). Clips only while
 * animating, so focus rings and popovers inside are never cut off at rest. Reduced motion: the
 * size changes instantly.
 */
export function AutoSize({ axis, children, className, style, duration = 0.3 }: AutoSizeProps & { axis: "height" | "width" }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<number | null>(null);
  const [size, setSize] = useState<number | "auto">("auto");
  const [animating, setAnimating] = useState(false);
  const reduce = useReducedMotionSafe();
  const reduceRef = useRef(reduce);
  useLayoutEffect(() => { reduceRef.current = reduce; }, [reduce]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const next = axis === "height" ? el.offsetHeight : el.offsetWidth;
      const box = outerRef.current;
      // The observer runs before this frame paints, but the box only reaches its new size (and only
      // clips) after React re-renders and the animation starts, a few frames later. Without this, grown
      // content would paint past the box's edge until then. So the stale-size frame is fixed here, on the
      // element: clipped when a glide is about to start, already at the new size under reduced motion.
      if (box && targetRef.current !== null && Math.abs(next - targetRef.current) > 0.5) {
        const shown = axis === "height" ? box.offsetHeight : box.offsetWidth;
        if (Math.abs(next - shown) > 0.5) {
          if (reduceRef.current) box.style[axis] = `${next}px`;
          else box.style.overflow = "hidden";
        }
      }
      targetRef.current = next;
      setSize(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);

  const inline = axis === "width";
  return (
    <motion.div
      ref={outerRef}
      className={className}
      initial={false}
      animate={axis === "height" ? { height: size } : { width: size }}
      transition={reduce ? { duration: 0 } : { duration, ease: EASE }}
      onAnimationStart={() => setAnimating(true)}
      onAnimationComplete={() => setAnimating(false)}
      style={{ ...style, ...(inline ? { display: "inline-block" } : null), overflow: animating ? "hidden" : "visible" }}
    >
      <div ref={innerRef} style={inline ? { display: "inline-flex", width: "max-content" } : undefined}>{children}</div>
    </motion.div>
  );
}

/** AutoSize for the common case: a card or panel whose content height changes. */
export default function AutoHeight(props: AutoSizeProps) {
  return <AutoSize axis="height" {...props} />;
}
