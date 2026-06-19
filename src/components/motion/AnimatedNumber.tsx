// Counts up to `value` for a satisfying score reveal. Respects reduced motion.
import { animate, motion, useMotionValue, useTransform, useReducedMotion } from "framer-motion";
import { useEffect } from "react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
}

const AnimatedNumber = ({ value, duration = 0.9 }: AnimatedNumberProps) => {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [value, duration, reduce, mv]);

  return <motion.span>{rounded}</motion.span>;
};

export default AnimatedNumber;
