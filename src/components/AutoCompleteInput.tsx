import React, { useState } from "react";
import { inputStyle, suggestionBoxStyle, suggestionItemHoverStyle, suggestionItemStyle } from "../constants/styles";

export default function AutocompleteInput({ placeholder, value, setValue, suggestions, onSubmit, customStyleInput = {}, customStyleSuggestion = {}}) {
  const [localSuggestions, setLocalSuggestions] = useState([]);

  const handleChange = (e) => {
    const inputValue = e.target.value;
    setValue(inputValue);

    // Filter suggestions based on input
    if (inputValue.trim().length >= 2) {
        setLocalSuggestions(
            suggestions.filter((s) =>
            s.toLowerCase().includes(inputValue.toLowerCase())
            )
        );
        } else {
        setLocalSuggestions([]);
    }
  };

  return (
    <div style={{ position: "relative", flex: "1", maxWidth: "300px", marginRight: "10px" }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        style={{...inputStyle, ...customStyleInput}}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim() !== "") {
            onSubmit(value);
            setLocalSuggestions([]);
          }
        }}
      />

      {localSuggestions.length > 0 && (
        <ul style={{ ...suggestionBoxStyle, ...customStyleSuggestion}}>
          {localSuggestions.map((s, idx) => (
            <li
              key={idx}
              onClick={() => {
                setValue(s);
                setLocalSuggestions([]);
              }}
              style={suggestionItemStyle}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  suggestionItemHoverStyle.backgroundColor)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
