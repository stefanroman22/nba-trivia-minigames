interface AvatarProps {
  initials: string;
  size?: number;
  bg?: string;
}

export default function Avatar({
  initials,
  size = 28,
  bg = "linear-gradient(140deg, var(--brand), var(--brand-deep))",
}: AvatarProps) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        color: "#fff",
        flex: "none",
      }}
    >
      {initials}
    </span>
  );
}
