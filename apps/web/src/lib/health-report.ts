import { passwordRange, matchPasswordRange } from "@vaultmaster/crypto";

export type HealthPhase = "idle" | "hashing" | "requesting" | "matching" | "completed" | "cancelled" | "error";
export interface HealthProgress { phase: HealthPhase; completed: number; total: number }

// No job, persistence, telemetry, API mutation or resumable partial report.
export async function checkPasswordBreaches(
  entries: readonly { id: string; password: string }[], signal: AbortSignal,
  guard: () => void, progress: (value: HealthProgress) => void,
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const assertCurrent = () => { signal.throwIfAborted(); guard(); };
  try {
    for (const [index, entry] of entries.entries()) {
      assertCurrent();
      progress({ phase: "hashing", completed: index, total: entries.length });
      const { prefix, suffix } = await passwordRange(entry.password);
      assertCurrent();
      progress({ phase: "requesting", completed: index, total: entries.length });
      const timeout = new AbortController();
      const abort = () => timeout.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 15_000);
      let text: string;
      try {
        const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
          signal: timeout.signal, headers: { "Add-Padding": "true" },
          credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
        });
        if (!response.ok) throw new Error("Breach check unavailable");
        text = await response.text();
        timeout.signal.throwIfAborted();
      } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
      assertCurrent();
      progress({ phase: "matching", completed: index, total: entries.length });
      results[entry.id] = matchPasswordRange(text, suffix);
      assertCurrent();
      progress({ phase: "matching", completed: index + 1, total: entries.length });
    }
    assertCurrent();
    return results;
  } catch {
    for (const id of Object.keys(results)) delete results[id];
    throw new Error("Breach check unavailable");
  }
}
