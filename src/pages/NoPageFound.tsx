import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import MotionButton from "../components/motion/MotionButton";

const NoPageFound = () => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        backgroundColor: "#1e1e1e",
        color: "#fff",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <h1 className="font-display" style={{ fontSize: "clamp(3rem, 14vw, 5rem)", marginBottom: "1rem", color: "#EA750E" }}>404</h1>
        <h2 className="font-display" style={{ fontSize: "clamp(1.5rem, 6vw, 2rem)", marginBottom: "1rem" }}>Page Not Found</h2>
        <p style={{ fontSize: "1rem", color: "#aaa", marginBottom: "2rem", maxWidth: "40ch" }}>
          Oops! The page you're looking for doesn't exist or has been moved.
        </p>
        <MotionButton onClick={() => navigate("/")}>Go Home</MotionButton>
      </motion.div>
    </div>
  );
};

export default NoPageFound;
