import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import SentryInit from "@/components/app/SentryInit";
import ServiceWorkerRegister from "@/components/app/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "VaultMaster — Secure Password Manager",
  description:
    "End-to-end encrypted, zero-knowledge password manager. Your passwords never leave your device unencrypted.",
  keywords: ["password manager", "encryption", "security", "zero-knowledge", "e2ee"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" data-scroll-behavior="smooth">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400;500;700;800&f[]=satoshi@400;500;700&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0a0e1a" />
      </head>
      <body className="antialiased">
        <SentryInit />
        <ServiceWorkerRegister />
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          duration={4000}
          toastOptions={{
            style: {
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              fontSize: "14px",
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
