"use client";

import { useState } from "react";
import { RefreshCw, Copy, Check, Sliders } from "lucide-react";
import {
  generatePassword,
  calculateStrength,
  getStrengthLabel,
  type PasswordOptions,
} from "@vaultmaster/crypto";
import { copyWithAutoClear } from "@/lib/clipboard";

function buildPassword(options: PasswordOptions) {
  return generatePassword(options);
}

export default function GeneratorPage() {
  const [options, setOptions] = useState<PasswordOptions>({
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    special: true,
    excludeAmbiguous: false,
  });
  const [password, setPassword] = useState(() => buildPassword(options));
  const [copied, setCopied] = useState(false);

  const strength = calculateStrength(password);
  const strengthLabel = getStrengthLabel(strength);

  const generate = () => {
    try {
      const pw = buildPassword(options);
      setPassword(pw);
      setCopied(false);
    } catch (e) {
      console.error(e);
    }
  };

  const updateOptions = (updater: (current: PasswordOptions) => PasswordOptions) => {
    setOptions((current) => {
      const next = updater(current);
      setPassword(buildPassword(next));
      setCopied(false);
      return next;
    });
  };

  const copyToClipboard = async () => {
    await copyWithAutoClear(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const strengthColors: Record<string, string> = {
    weak: "#ff4d6a",
    fair: "#ff8c42",
    good: "#ffb020",
    strong: "#00cc8e",
    excellent: "#00ffb2",
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 font-[family-name:var(--font-display)]">
        Şifre Üretici
      </h2>

      {/* Generated Password Display */}
      <div className="glass rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 bg-abyss rounded-xl p-4 overflow-x-auto">
            <p
              className="font-[family-name:var(--font-mono)] text-lg tracking-wider whitespace-nowrap select-all"
              style={{ color: strengthColors[strengthLabel] }}
            >
              {password}
            </p>
          </div>

          <button
            onClick={copyToClipboard}
            className="p-3 rounded-xl bg-surface hover:bg-surface-hover border border-border transition-all shrink-0"
            title="Kopyala"
          >
            {copied ? (
              <Check className="w-5 h-5 text-accent" />
            ) : (
              <Copy className="w-5 h-5 text-text-secondary" />
            )}
          </button>

          <button
            onClick={generate}
            className="p-3 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-all shrink-0"
            title="Yenile"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Strength Meter */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-abyss rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${strength}%`,
                backgroundColor: strengthColors[strengthLabel],
              }}
            />
          </div>
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: strengthColors[strengthLabel] }}
          >
            {strengthLabel === "weak" && "Zayıf"}
            {strengthLabel === "fair" && "Orta"}
            {strengthLabel === "good" && "İyi"}
            {strengthLabel === "strong" && "Güçlü"}
            {strengthLabel === "excellent" && "Mükemmel"}
          </span>
        </div>
      </div>

      {/* Options */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <Sliders className="w-4 h-4 text-accent" />
          <h3 className="font-semibold">Parametreler</h3>
        </div>

        {/* Length Slider */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm text-text-secondary">Uzunluk</label>
            <span className="text-sm font-[family-name:var(--font-mono)] text-accent font-semibold bg-accent/10 px-2.5 py-0.5 rounded-lg">
              {options.length}
            </span>
          </div>
          <input
            type="range"
            min={4}
            max={64}
            value={options.length}
            onChange={(e) =>
              updateOptions((o) => ({ ...o, length: Number(e.target.value) }))
            }
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-text-muted mt-1">
            <span>4</span>
            <span>64</span>
          </div>
        </div>

        {/* Character Set Toggles */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "lowercase" as const, label: "Küçük Harf (a-z)" },
            { key: "uppercase" as const, label: "Büyük Harf (A-Z)" },
            { key: "digits" as const, label: "Rakamlar (0-9)" },
            { key: "special" as const, label: "Özel Karakterler (!@#)" },
            { key: "excludeAmbiguous" as const, label: "Benzer Hariç (l,1,I,O,0)" },
          ].map(({ key, label }) => (
            <label
              key={key}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                options[key] ? "bg-accent/5 border-accent/30" : "bg-surface border-border hover:border-border"
              }`}
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) =>
                  updateOptions((o) => ({ ...o, [key]: e.target.checked }))
                }
                className="sr-only"
              />
              <div
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                  options[key]
                    ? "bg-accent border-accent"
                    : "border-text-muted"
                }`}
              >
                {options[key] && (
                  <Check className="w-3 h-3 text-midnight" />
                )}
              </div>
              <span className="text-sm text-text-primary">{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
