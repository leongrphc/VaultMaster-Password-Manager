"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notify";
import { captureWebException } from "@/lib/sentry";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureWebException(error, { digest: error.digest });
    notify.error(error.message || "Uygulamada beklenmeyen bir hata oluştu.");
  }, [error]);
  return (
    <html lang="tr" data-scroll-behavior="smooth">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400;500;700;800&f[]=satoshi@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-midnight text-text-primary">
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="glass rounded-2xl p-8 max-w-md w-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-danger" />
            </div>
            <h2 className="text-xl font-bold mb-2">
              Uygulama Hatası
            </h2>
            <p className="text-text-secondary text-sm mb-6">
              Beklenmeyen bir hata oluştu. Lütfen sayfayı yenilemeyi deneyin.
            </p>
            <button
              onClick={() => reset()}
              className="bg-accent hover:bg-accent-dim text-midnight font-semibold px-6 py-2.5 rounded-xl inline-flex items-center gap-2 transition-all text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Sayfayı Yenile
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
