import type { CSSProperties, ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  variant?: "default" | "brand" | "good" | "bad";
  dot?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function Chip({ children, variant = "default", dot = false, className = "", style }: ChipProps) {
  const v = variant === "default" ? "" : ` chip-${variant}`;
  return (
    <span className={`chip${v}${className ? " " + className : ""}`} style={style}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}
