interface CorrectAnswerProps {
  label: string;   // e.g., "answer" or "team"
  value?: string;  // optional
}

const CorrectAnswer = ({ label, value } : CorrectAnswerProps) => {
  if (!value) return null; // don't render if no value

  return (
    <p style={{ color: "#C8102E", fontWeight: "bold", marginTop: "1rem" }}>
      Correct {label}: {value}
    </p>
  );
};



export default CorrectAnswer;
