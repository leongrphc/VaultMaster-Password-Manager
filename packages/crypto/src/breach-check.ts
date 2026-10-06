// SHA-1 is required by the Pwned Passwords range protocol, never for vault encryption.
export async function passwordRange(password: string): Promise<{ prefix: string; suffix: string }> {
  const bytes = new TextEncoder().encode(password);
  try {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
    const hex = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    if (hex.length !== 40) throw new Error("Breach check unavailable");
    return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
  } finally { bytes.fill(0); }
}

export function matchPasswordRange(text: string, suffix: string): number {
  if (!/^[A-F0-9]{35}$/.test(suffix) || !text.trim() || text.length > 2_000_000) throw new Error("Invalid range response");
  let count = 0;
  const seen = new Set<string>();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([A-F0-9]{35}):(\d+)$/.exec(line);
    if (!match || seen.has(match[1]!) || !Number.isSafeInteger(Number(match[2]))) throw new Error("Invalid range response");
    seen.add(match[1]!);
    if (match[1] === suffix) count = Number(match[2]);
  }
  return count;
}
