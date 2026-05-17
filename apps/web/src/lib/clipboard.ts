import { notify } from "@/lib/notify";

const CLIPBOARD_CLEAR_DELAY_MS = 30_000;

let pendingClipboardClear: number | null = null;

function clearPendingClipboardTimeout() {
  if (pendingClipboardClear !== null) {
    window.clearTimeout(pendingClipboardClear);
    pendingClipboardClear = null;
  }
}

export async function copyWithAutoClear(text: string) {
  await navigator.clipboard.writeText(text);

  clearPendingClipboardTimeout();
  pendingClipboardClear = window.setTimeout(() => {
    void clearClipboardIfUnchanged(text);
  }, CLIPBOARD_CLEAR_DELAY_MS);
}

async function clearClipboardIfUnchanged(expectedValue: string) {
  try {
    const currentValue = await navigator.clipboard.readText();
    if (currentValue !== expectedValue) {
      return;
    }

    await navigator.clipboard.writeText("");
  } catch (error) {
    console.error("Pano otomatik temizlenemedi:", error);
    notify.clipboardAutoClearFailed();
  } finally {
    pendingClipboardClear = null;
  }
}
