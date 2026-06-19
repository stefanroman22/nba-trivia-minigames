// Drop-in animated button: spring hover/tap feedback that also works on touch
// and keyboard, replacing the inline mouse-event style mutations.
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { buttonStyle } from "../../constants/styles";

type MotionButtonProps = HTMLMotionProps<"button">;

export default function MotionButton({ children, style, disabled, ...rest }: MotionButtonProps) {
  const reduce = useReducedMotion();
  const interactive = !reduce && !disabled;

  return (
    <motion.button
      disabled={disabled}
      style={{ ...buttonStyle, cursor: disabled ? "not-allowed" : "pointer", ...style }}
      whileHover={interactive ? { scale: 1.04, backgroundColor: "#ff8c1a" } : undefined}
      whileTap={interactive ? { scale: 0.95 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
