"use client";

import { Search, Sparkles } from "lucide-react";
import { getSearchHelp } from "@/lib/search";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  const suggestions = getSearchHelp(value);

  return (
    <div className="relative flex-1 max-w-xl group">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
      <input
        id="vault-search-input"
        type="text"
        placeholder="Ara veya komut kullan: type:login @url:github has:totp"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-surface border border-border rounded-xl py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="pointer-events-none absolute left-0 right-0 top-[calc(100%+8px)] z-20 hidden rounded-2xl border border-accent/15 bg-abyss/95 p-3 shadow-2xl shadow-black/30 backdrop-blur-xl group-focus-within:block">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">
          <Sparkles className="w-3.5 h-3.5" />
          Gelişmiş arama
        </div>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <span key={suggestion} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-secondary">
              {suggestion}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
