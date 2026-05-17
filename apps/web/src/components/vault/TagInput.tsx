"use client";

import { useState, useRef, useEffect } from "react";
import { X, Plus, Tag } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  idPrefix?: string;
}

export default function TagInput({ tags, onChange, suggestions = [], idPrefix = "tag-input" }: TagInputProps) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const inputId = `${idPrefix}-input`;

  const filteredSuggestions = suggestions.filter(
    (s) =>
      s.toLowerCase().includes(input.toLowerCase()) &&
      !tags.includes(s) &&
      input.length > 0
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tagColors = [
    "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "bg-purple-500/15 text-purple-400 border-purple-500/30",
    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "bg-rose-500/15 text-rose-400 border-rose-500/30",
    "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
    "bg-pink-500/15 text-pink-400 border-pink-500/30",
  ];

  const getTagColor = (tag: string) => {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return tagColors[Math.abs(hash) % tagColors.length];
  };

  return (
    <div>
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm text-text-secondary mb-2">
        <Tag className="w-3.5 h-3.5" />
        Etiketler
      </label>
      <div className="relative">
        <div className="flex flex-wrap gap-1.5 bg-abyss border border-border rounded-xl py-2 px-3 min-h-[42px] focus-within:border-accent/50 transition-colors">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border ${getTagColor(tag)}`}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="hover:opacity-70 transition-opacity"
                aria-label={`Etiketi kaldır: ${tag}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            id={inputId}
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            placeholder={tags.length === 0 ? "Etiket ekle..." : ""}
            className="flex-1 min-w-[80px] bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>

        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl overflow-hidden z-20 shadow-lg">
            {filteredSuggestions.slice(0, 5).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => addTag(suggestion)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <Plus className="w-3 h-3" />
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { type TagInputProps };
