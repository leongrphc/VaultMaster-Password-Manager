"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        void Promise.all(registrations.map((registration) => registration.unregister()));
      });

      if ("caches" in window) {
        void caches.keys().then((keys) => {
          void Promise.all(
            keys
              .filter((key) => key.startsWith("vaultmaster-"))
              .map((key) => caches.delete(key))
          );
        });
      }

      return;
    }

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.error("Service worker kaydı başarısız:", error);
    });
  }, []);

  return null;
}
