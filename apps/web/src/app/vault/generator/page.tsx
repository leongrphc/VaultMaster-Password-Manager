"use client";

import { observe } from "@/lib/observability";

import { useState } from "react";
import { RefreshCw, Copy, Check, Sliders } from "lucide-react";
import {
  generatePassword,
  generatePassphrase,
  calculateStrength,
  getStrengthLabel,
  type PasswordOptions,
  type PassphraseOptions,
} from "@vaultmaster/crypto";
import { copyWithAutoClear } from "@/lib/clipboard";
import { notify } from "@/lib/notify";

type GeneratorMode = "password" | "passphrase";

const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  special: true,
  excludeAmbiguous: false,
};

const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  wordCount: 4,
  separator: "-",
  capitalize: false,
  includeNumber: false,
};

function buildSecret(
  mode: GeneratorMode,
  passwordOptions: PasswordOptions,
  passphraseOptions: PassphraseOptions
) {
  return mode === "password"
    ? generatePassword(passwordOptions)
    : generatePassphrase(passphraseOptions);
}

export default function GeneratorPage() {
  const [mode, setMode] = useState<GeneratorMode>("password");
  const [passwordOptions, setPasswordOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [passphraseOptions, setPassphraseOptions] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS);
  const [password, setPassword] = useState(() =>
    buildSecret("password", DEFAULT_PASSWORD_OPTIONS, DEFAULT_PASSPHRASE_OPTIONS)
  );
  const [copied, setCopied] = useState(false);

  const strength = calculateStrength(password);
  const strengthLabel = getStrengthLabel(strength);

  const generate = () => {
    try {
      const pw = buildSecret(mode, passwordOptions, passphraseOptions);
      setPassword(pw);
      setCopied(false);
    } catch {
      observe("client_error", { operation: "client", outcome: "failure", reason: "internal" });
    }
  };

  const updateMode = (nextMode: GeneratorMode) => {
    setMode(nextMode);
    setPassword(buildSecret(nextMode, passwordOptions, passphraseOptions));
    setCopied(false);
  };

  const updatePasswordOptions = (updater: (current: PasswordOptions) => PasswordOptions) => {
    setPasswordOptions((current) => {
      const next = updater(current);
      setPassword(buildSecret(mode, next, passphraseOptions));
      setCopied(false);
      return next;
    });
  };

  const updatePassphraseOptions = (updater: (current: PassphraseOptions) => PassphraseOptions) => {
    setPassphraseOptions((current) => {
      const next = updater(current);
      setPassword(buildSecret(mode, passwordOptions, next));
      setCopied(false);
      return next;
    });
  };

  const copyToClipboard = async () => {
    await copyWithAutoClear(password);
    setCopied(true);
    notify.copied("Şifre");
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
            type="button"
            onClick={copyToClipboard}
            className="p-3 rounded-xl bg-surface hover:bg-surface-hover border border-border transition-all shrink-0"
            title="Kopyala"
            aria-label={copied ? "Şifre kopyalandı" : "Şifreyi kopyala"}
          >
            {copied ? (
              <Check className="w-5 h-5 text-accent" />
            ) : (
              <Copy className="w-5 h-5 text-text-secondary" />
            )}
          </button>

          <button
            type="button"
            onClick={generate}
            className="p-3 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-all shrink-0"
            title="Yenile"
            aria-label="Yeni şifre oluştur"
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

        <div className="grid grid-cols-2 gap-2 mb-6 rounded-xl bg-abyss p-1">
          {[
            { value: "password" as const, label: "Şifre" },
            { value: "passphrase" as const, label: "Kelime Grubu" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => updateMode(item.value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === item.value
                  ? "bg-accent text-midnight"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === "password" ? (
          <>
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-text-secondary">Uzunluk</label>
                <span className="text-sm font-[family-name:var(--font-mono)] text-accent font-semibold bg-accent/10 px-2.5 py-0.5 rounded-lg">
                  {passwordOptions.length}
                </span>
              </div>
              <input
                type="range"
                min={4}
                max={64}
                value={passwordOptions.length}
                onChange={(e) =>
                  updatePasswordOptions((o) => ({ ...o, length: Number(e.target.value) }))
                }
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>4</span>
                <span>64</span>
              </div>
            </div>

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
                    passwordOptions[key] ? "bg-accent/5 border-accent/30" : "bg-surface border-border hover:border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={passwordOptions[key]}
                    onChange={(e) =>
                      updatePasswordOptions((o) => ({ ...o, [key]: e.target.checked }))
                    }
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                      passwordOptions[key]
                        ? "bg-accent border-accent"
                        : "border-text-muted"
                    }`}
                  >
                    {passwordOptions[key] && (
                      <Check className="w-3 h-3 text-midnight" />
                    )}
                  </div>
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-text-secondary">Kelime Sayısı</label>
                <span className="text-sm font-[family-name:var(--font-mono)] text-accent font-semibold bg-accent/10 px-2.5 py-0.5 rounded-lg">
                  {passphraseOptions.wordCount}
                </span>
              </div>
              <input
                type="range"
                min={3}
                max={8}
                value={passphraseOptions.wordCount}
                onChange={(e) =>
                  updatePassphraseOptions((o) => ({ ...o, wordCount: Number(e.target.value) }))
                }
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>3</span>
                <span>8</span>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm text-text-secondary mb-3">Ayırıcı</label>
              <select
                value={passphraseOptions.separator}
                onChange={(e) =>
                  updatePassphraseOptions((o) => ({ ...o, separator: e.target.value }))
                }
                className="w-full rounded-xl bg-abyss border border-border px-4 py-3 text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="-">Tire (-)</option>
                <option value=".">Nokta (.)</option>
                <option value="_">Alt çizgi (_)</option>
                <option value=" ">Boşluk</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "capitalize" as const, label: "Kelimeleri Büyük Başlat" },
                { key: "includeNumber" as const, label: "Sayı Ekle" },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    passphraseOptions[key] ? "bg-accent/5 border-accent/30" : "bg-surface border-border hover:border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={passphraseOptions[key]}
                    onChange={(e) =>
                      updatePassphraseOptions((o) => ({ ...o, [key]: e.target.checked }))
                    }
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                      passphraseOptions[key]
                        ? "bg-accent border-accent"
                        : "border-text-muted"
                    }`}
                  >
                    {passphraseOptions[key] && (
                      <Check className="w-3 h-3 text-midnight" />
                    )}
                  </div>
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
