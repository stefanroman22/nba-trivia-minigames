import { motion, type HTMLMotionProps } from "framer-motion";

interface SurfaceProps extends HTMLMotionProps<"div"> {
  tone?: "1" | "2";
}

/** Bordered surface card. Pass framer-motion props for entrance animations. */
export default function Surface({ tone = "1", className = "", children, ...rest }: SurfaceProps) {
  return (
    <motion.div className={`${tone === "2" ? "surface-2" : "surface"}${className ? " " + className : ""}`} {...rest}>
      {children}
    </motion.div>
  );
}
