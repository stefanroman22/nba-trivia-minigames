// CorrectAnswer.js
import React from "react";
import PropTypes from "prop-types";

const CorrectAnswer = ({ label, value }) => {
  if (!value) return null; // don't render if no value

  return (
    <p style={{ color: "#C8102E", fontWeight: "bold", marginTop: "1rem" }}>
      Correct {label}: {value}
    </p>
  );
};

CorrectAnswer.propTypes = {
  label: PropTypes.string.isRequired, // e.g. "answer" or "team"
  value: PropTypes.string,            // the actual text to display
};

export default CorrectAnswer;
