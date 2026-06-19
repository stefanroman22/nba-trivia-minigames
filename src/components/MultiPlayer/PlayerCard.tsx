import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrophy, faStar } from "@fortawesome/free-solid-svg-icons";
import defaultAvatar from "../../assets/default.png";

interface PlayerCardProps {
  username?: string;
  profilePhoto?: string | null;
  role?: string;
  rank?: string | number;
  points?: string | number;
  delay?: number;
}

const PlayerCard = ({ username, profilePhoto, role, rank, points, delay = 0 }: PlayerCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: "#1f1f1f",
        padding: "0.8rem",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
        width: "clamp(110px, 32vw, 150px)",
        boxSizing: "border-box",
      }}
    >
      {/* Profile Photo */}
      <img
        src={profilePhoto || defaultAvatar}
        alt={username || "Player"}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = defaultAvatar;
        }}
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          objectFit: "cover",
          marginBottom: "0.4rem",
          border: "2px solid var(--brand, #ff7a1a)",
        }}
      />

      {/* Username */}
      <p
        style={{
          margin: 0,
          fontWeight: "bold",
          fontSize: "0.95rem",
          color: "#fff",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          overflow: "hidden",
          maxWidth: "100%",
        }}
      >
        {username || "Guest"}
      </p>

      {/* Role */}
      <p style={{ margin: "0.2rem 0", fontSize: "0.75rem", color: "#aaa" }}>{role}</p>

      {/* Rank & Points Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          gap: "0.4rem",
          minWidth: 0,
          fontSize: "0.75rem",
          color: "#bbb",
          marginTop: "0.3rem",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", minWidth: 0 }}>
          <FontAwesomeIcon icon={faTrophy} style={{ color: "#ffd166" }} /> {rank}
        </span>
        <span className="tnum" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <FontAwesomeIcon icon={faStar} style={{ color: "#ff9d3c" }} /> {points}
        </span>
      </div>
    </motion.div>
  );
};

export default PlayerCard;
