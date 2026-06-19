// Scroll-triggered reveal wrapper. Animates children in on enter-viewport,
// respects prefers-reduced-motion, and supports staggering child <Reveal>s.
import { motion, useReducedMotion, type Variants, type HTMLMotionProps } from "framer-motion";
import { fadeInUp } from "../../motion/variants";

interface RevealProps extends HTMLMotionProps<"div"> {
  variants?: Variants;
  /** how much of the element must be visible before animating (0-1) */
  amount?: number;
  once?: boolean;
}

export default function Reveal({
  children,
  variants = fadeInUp,
  amount = 0.2,
  once = true,
  ...rest
}: RevealProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      variants={variants}
      initial={reduce ? "visible" : "hidden"}
      whileInView="visible"
      viewport={{ once, amount }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
