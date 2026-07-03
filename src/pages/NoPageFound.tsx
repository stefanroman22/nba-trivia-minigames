import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "../components/ui";

const NoPageFound = () => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "70vh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "3rem 1.5rem",
        textAlign: "center",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxWidth: 460 }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid var(--line2)",
            background: "var(--brand-soft)",
            color: "var(--brand)",
            fontSize: 11,
            letterSpacing: 1.5,
            fontWeight: 600,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 0 4px var(--brand-soft)" }} />
          NEW GAME IN THE WORKS
        </span>

        <h1 className="font-display gradient-orange" style={{ fontSize: "clamp(3.5rem, 16vw, 6rem)", lineHeight: 1 }}>404</h1>
        <h2 className="font-display" style={{ fontSize: "clamp(1.4rem, 6vw, 2rem)" }}>Nothing here yet</h2>
        <p style={{ fontSize: "1rem", color: "var(--muted)", lineHeight: 1.55, maxWidth: "42ch" }}>
          This page or game isn&rsquo;t ready yet. Our team is warming up on the sidelines, check back soon for new challenges.
        </p>
        <Button size="lg" onClick={() => navigate("/")} style={{ marginTop: 8 }}>
          Back to games
        </Button>
      </motion.div>
    </div>
  );
};

export default NoPageFound;
