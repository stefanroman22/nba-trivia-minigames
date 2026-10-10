import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** Looks and reads as disabled (aria-disabled) but still receives the press, so the caller can
   *  explain why nothing happened instead of ignoring the click (e.g. "Close or finish current game first."). */
  blocked?: boolean;
}

/**
 * Design-system button. Hover lifts it, a click presses it "forward" (scale
 * down + spring back) for tactile feedback that also works on touch/keyboard.
 */
export default function Button({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  children,
  disabled,
  blocked = false,
  ...rest
}: ButtonProps) {
  const reduce = useReducedMotion();
  const interactive = !reduce && !disabled && !blocked;

  return (
    <motion.button
      className={`btn btn-${variant} btn-${size}${block ? " btn-block" : ""}${blocked ? " is-blocked" : ""}${className ? " " + className : ""}`}
      disabled={disabled}
      aria-disabled={blocked || undefined}
      whileHover={interactive ? { y: -2 } : undefined}
      whileTap={interactive ? { scale: 0.95, y: 0 } : undefined}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
