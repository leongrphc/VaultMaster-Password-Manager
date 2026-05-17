import { calculateStrength, getStrengthLabel } from "@vaultmaster/crypto";

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

const strengthMeta = {
  weak: {
    label: "Zayıf",
    color: "#ff4d6d",
    guidance: "Daha uzun ve benzersiz bir ana şifre seçin.",
  },
  fair: {
    label: "Orta",
    color: "#ff8c42",
    guidance: "Büyük/küçük harf, rakam ve sembol ekleyin.",
  },
  good: {
    label: "İyi",
    color: "#ffb020",
    guidance: "İyi görünüyor; daha uzun olması daha güvenlidir.",
  },
  strong: {
    label: "Güçlü",
    color: "#00cc8e",
    guidance: "Güçlü ana şifre.",
  },
  excellent: {
    label: "Mükemmel",
    color: "#00ffb2",
    guidance: "Çok güçlü ana şifre.",
  },
};

export default function PasswordStrengthMeter({
  password,
  className = "",
}: PasswordStrengthMeterProps) {
  const strength = password ? calculateStrength(password) : 0;
  const label = getStrengthLabel(strength);
  const meta = password
    ? strengthMeta[label]
    : {
        label: "Rehber",
        color: "#94a3b8",
        guidance: "En az 12 karakter, büyük/küçük harf, rakam ve sembol önerilir.",
      };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${strength}%`, backgroundColor: meta.color }}
          />
        </div>
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
      </div>
      <p className="text-xs text-text-muted">{meta.guidance}</p>
    </div>
  );
}
