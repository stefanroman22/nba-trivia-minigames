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
  const innerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | "auto">("auto");
  const [animating, setAnimating] = useState(false);
  const reduce = useReducedMotionSafe();

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setSize(axis === "height" ? el.offsetHeight : el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);

  const inline = axis === "width";
  return (
    <motion.div
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
