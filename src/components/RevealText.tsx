import React from "react";
import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: (i = 1) => ({
    opacity: 1,
    transition: { staggerChildren: 0.4, delayChildren: 0.04 * i },
  }),
};

const childVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      damping: 20,
      stiffness: 70,
    },
  },
  hidden: {
    opacity: 0,
    y: 20,
    transition: {
      type: "spring",
      damping: 20,
      stiffness: 100,
    },
  },
};

// We split classes into 'className' (for the container) and 'textClassName' (for the words)
const RevealText = ({ text, className = "", textClassName = "" }) => {
  const words = text.split(" ");

  return (
    <motion.h1
      className={`flex flex-wrap justify-center overflow-hidden ${className}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {words.map((word, index) => (
        <motion.span
          key={index}
          variants={childVariants}
          className={`mr-2 last:mr-0 pb-2 ${textClassName}`}
        >
          {word}
        </motion.span>
      ))}
    </motion.h1>
  );
};

export default RevealText;