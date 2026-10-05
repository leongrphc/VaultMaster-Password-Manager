"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export default function SessionCoordinator() {
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== "vaultmaster-auth" || !event.newValue) return;
      try { useStore.getState().syncExternalSession(JSON.parse(event.newValue).state); } catch { /* Ignore invalid external state. */ }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return null;
}
