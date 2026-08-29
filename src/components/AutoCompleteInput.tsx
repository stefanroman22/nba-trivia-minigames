import { useState, type ChangeEvent, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { inputStyle, suggestionBoxStyle, suggestionItemHoverStyle, suggestionItemStyle } from "../constants/styles";

interface AutocompleteInputProps {
  placeholder?: string;
  value: string;
  setValue: (value: string) => void;
  suggestions: string[];
  onSubmit: (value: string) => void;
  customStyleInput?: CSSProperties;
  customStyleSuggestion?: CSSProperties;
  // Cap the dropdown (prefix matches first) — needed for large pools like the
  // ~5k player list. Omitted = show every match (existing behavior).
  maxResults?: number;
}

export default function AutocompleteInput({
  placeholder,
  value,
  setValue,
  suggestions,
  onSubmit,
  customStyleInput = {},
  customStyleSuggestion = {},
  maxResults,
}: AutocompleteInputProps) {
  const [localSuggestions, setLocalSuggestions] = useState<string[]>([]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setValue(inputValue);

    // Filter suggestions based on input (guard against non-string entries)
    if (inputValue.trim().length >= 2) {
      const q = inputValue.toLowerCase();
      const matches = (suggestions || []).filter(
        (s) => typeof s === "string" && s.toLowerCase().includes(q)
      );
      if (maxResults && maxResults > 0) {
        // Prefer prefix matches, then shorter (closer) names, then cap — keeps
        // the dropdown tight and relevant for large pools.
        matches.sort((a, b) => {
          const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
          const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
          return ap !== bp ? ap - bp : a.length - b.length;
        });
        setLocalSuggestions(matches.slice(0, maxResults));
      } else {
        setLocalSuggestions(matches);
      }
    } else {
      setLocalSuggestions([]);
    }
  };

  return (
    <div style={{ position: "relative", flex: "1", width: "100%", maxWidth: "300px" }}>
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

      <AnimatePresence>
        {localSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            style={{ position: "absolute", top: "100%", left: 0, width: "100%", zIndex: 1000 }}
          >
            <ul style={{ ...suggestionBoxStyle, position: "static", ...customStyleSuggestion }}>
              {localSuggestions.map((s, idx) => (
                <li
                  key={idx}
                  onClick={() => {
                    setValue(s);
                    setLocalSuggestions([]);
                  }}
                  style={{
                    ...suggestionItemStyle,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
