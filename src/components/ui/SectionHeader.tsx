import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export default function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <h2 className="font-display" style={{ fontSize: "clamp(22px, 3vw, 28px)" }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
