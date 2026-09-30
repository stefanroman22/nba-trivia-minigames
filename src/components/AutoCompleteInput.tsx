import { useEffect, useId, useState, type ChangeEvent, type CSSProperties } from "react";
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
  const [localSuggestions, setSuggestionList] = useState<string[]>([]);
  // Keyboard-highlighted option (-1 = none); DOM focus stays in the input (aria-activedescendant).
  const [highlight, setHighlight] = useState(-1);
  // Pointer-hovered option: styling only, so a resting mouse never hijacks Enter.
  const [hover, setHover] = useState(-1);
  const listId = useId();
  const open = localSuggestions.length > 0;

  const setLocalSuggestions = (next: string[]) => {
    setSuggestionList(next);
    setHighlight(-1);
    setHover(-1);
  };
  const close = () => setLocalSuggestions([]);

  // Keep the highlighted option visible inside the scrollable list.
  useEffect(() => {
    if (highlight >= 0) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, listId]);

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
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            setHighlight((h) => (h >= localSuggestions.length - 1 ? 0 : h + 1));
            return;
          }
          if (e.key === "ArrowUp" && open) {
            e.preventDefault();
            setHighlight((h) => (h <= 0 ? localSuggestions.length - 1 : h - 1));
            return;
          }
          if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
            return;
          }
          if (e.key === "Tab" && open) {
            close(); // no preventDefault — Tab still moves focus
            return;
          }
          if (e.key === "Enter") {
            if (open && highlight >= 0) {
              e.preventDefault();
              setValue(localSuggestions[highlight]);
              close();
              return;
            }
            if (value.trim() !== "") {
              onSubmit(value);
              close();
            }
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
            <ul id={listId} role="listbox" style={{ ...suggestionBoxStyle, position: "static", ...customStyleSuggestion }}>
              {localSuggestions.map((s, idx) => (
                <li
                  key={idx}
                  id={`${listId}-${idx}`}
                  role="option"
                  aria-selected={idx === highlight}
                  onClick={() => {
                    setValue(s);
                    close();
                  }}
                  style={{
                    ...suggestionItemStyle,
                    ...(idx === highlight || idx === hover ? { backgroundColor: suggestionItemHoverStyle.backgroundColor } : {}),
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(-1)}
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
