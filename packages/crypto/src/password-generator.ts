const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SPECIAL = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`";

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  special: boolean;
  excludeAmbiguous: boolean; // l, 1, I, O, 0 gibi benzer karakterleri hariç tut
}

export const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  special: true,
  excludeAmbiguous: false,
};

export interface PassphraseOptions {
  wordCount: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  wordCount: 4,
  separator: "-",
  capitalize: false,
  includeNumber: false,
};

const DICEWARE_WORDS = [
  "ada", "akil", "alev", "altin", "anahtar", "armut", "aslan", "aydin",
  "bahar", "balik", "baris", "baykus", "bulut", "burun", "cam", "ceviz",
  "cinar", "dag", "deniz", "derin", "dolap", "dut", "elma", "emek",
  "fidan", "fikir", "fil", "gemi", "gok", "golge", "guven", "halat",
  "harita", "irmak", "isik", "kalem", "kaplan", "kaya", "kiraz", "kitap",
  "kopek", "kopru", "kule", "liman", "lodos", "masa", "mercam", "merdiven",
  "mavi", "orman", "pamuk", "pazar", "pirinc", "pusula", "radyo", "renk",
  "sahil", "sandal", "sari", "serin", "simsek", "tarla", "tas", "tilki",
  "toprak", "turna", "umut", "uzay", "vadi", "yelken", "yildiz", "zeytin",
] as const;

const AMBIGUOUS = new Set(["l", "1", "I", "O", "0", "|"]);

export function generatePassword(
  options: Partial<PasswordOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let charset = "";
  const required: string[] = [];

  if (opts.lowercase) {
    const chars = opts.excludeAmbiguous
      ? LOWERCASE.replace("l", "")
      : LOWERCASE;
    charset += chars;
    required.push(pickRandom(chars));
  }
  if (opts.uppercase) {
    const chars = opts.excludeAmbiguous
      ? UPPERCASE.replace("I", "").replace("O", "")
      : UPPERCASE;
    charset += chars;
    required.push(pickRandom(chars));
  }
  if (opts.digits) {
    const chars = opts.excludeAmbiguous
      ? DIGITS.replace("0", "").replace("1", "")
      : DIGITS;
    charset += chars;
    required.push(pickRandom(chars));
  }
  if (opts.special) {
    const chars = opts.excludeAmbiguous
      ? SPECIAL.replace("|", "")
      : SPECIAL;
    charset += chars;
    required.push(pickRandom(chars));
  }

  if (charset.length === 0) {
    throw new Error("En az bir karakter seti seçilmeli");
  }

  const length = Math.max(opts.length, required.length);
  const remaining = length - required.length;
  const randomChars: string[] = [];

  for (let i = 0; i < remaining; i++) {
    randomChars.push(pickRandom(charset));
  }

  const allChars = [...required, ...randomChars];
  return shuffleArray(allChars).join("");
}

export function generatePassphrase(
  options: Partial<PassphraseOptions> = {}
): string {
  const opts = { ...DEFAULT_PASSPHRASE_OPTIONS, ...options };
  const wordCount = Math.max(3, Math.min(12, Math.floor(opts.wordCount)));
  const words: string[] = [];

  for (let i = 0; i < wordCount; i++) {
    const word = pickRandomFromArray(DICEWARE_WORDS);
    words.push(opts.capitalize ? capitalizeWord(word) : word);
  }

  if (opts.includeNumber) {
    const lastIndex = words.length - 1;
    words[lastIndex] = `${words[lastIndex]}${pickRandom(DIGITS)}`;
  }

  return words.join(opts.separator);
}

/**
 * Şifre sağlamlığını 0-100 arasında puanlar.
 */
export function calculateStrength(password: string): number {
  let score = 0;

  if (password.length >= 8) score += 10;
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;
  if (password.length >= 20) score += 10;

  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/[0-9]/.test(password)) score += 10;
  if (/[^a-zA-Z0-9]/.test(password)) score += 15;

  const uniqueChars = new Set(password).size;
  const uniqueRatio = uniqueChars / password.length;
  score += Math.floor(uniqueRatio * 15);

  return Math.min(100, score);
}

export function getStrengthLabel(
  score: number
): "weak" | "fair" | "good" | "strong" | "excellent" {
  if (score < 30) return "weak";
  if (score < 50) return "fair";
  if (score < 70) return "good";
  if (score < 90) return "strong";
  return "excellent";
}

function pickRandom(str: string): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return str[array[0]! % str.length]!;
}

function pickRandomFromArray<T>(items: readonly T[]): T {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return items[array[0]! % items.length]!;
}

function capitalizeWord(word: string): string {
  return `${word[0]!.toUpperCase()}${word.slice(1)}`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  const randomValues = new Uint32Array(shuffled.length);
  crypto.getRandomValues(randomValues);

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomValues[i]! % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
