// PointsPopup.jsx
import React from "react";
import PropTypes from "prop-types";

const SubmitGuessPopup = ({ text, color, duration = 2 }) => {
  return (
    <div
      style={{
        position: "fixed", // stays visible on mobile scroll
        top: "15%", // safer than 20px on small screens
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: color,
        padding: "0.75rem 1.5rem",
        borderRadius: "8px",
        fontWeight: "bold",
        color: "#fff",
        fontSize: "1rem",
        maxWidth: "90%", // prevents overflow
        textAlign: "center",
        zIndex: 9999, // ensures visibility
        animation: `fadeInOut ${duration}s ease-in-out`,
        boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
      }}
    >
      {text}
    </div>
  );
};

SubmitGuessPopup.propTypes = {
  text: PropTypes.string.isRequired,
  color: PropTypes.string,
  duration: PropTypes.number,
};

export default SubmitGuessPopup;
