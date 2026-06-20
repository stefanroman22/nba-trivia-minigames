import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
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
  ...rest
}: ButtonProps) {
  const reduce = useReducedMotion();
  const interactive = !reduce && !disabled;

  return (
    <motion.button
      className={`btn btn-${variant} btn-${size}${block ? " btn-block" : ""}${className ? " " + className : ""}`}
      disabled={disabled}
      whileHover={interactive ? { y: -2 } : undefined}
      whileTap={interactive ? { scale: 0.95, y: 0 } : undefined}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
