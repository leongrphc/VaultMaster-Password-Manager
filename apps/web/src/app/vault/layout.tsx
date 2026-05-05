"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import Sidebar from "@/components/layout/Sidebar";
import VaultHeader from "@/components/vault/VaultHeader";
import LockScreen from "@/components/vault/LockScreen";
import BrowserExtensionBridge from "@/components/app/BrowserExtensionBridge";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";
import CommandPalette from "@/components/vault/CommandPalette";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useShallow } from "zustand/shallow";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const {
    isAuthenticated,
    isLocked,
    lockVault,
    touchActivity,
    lockTimeoutMinutes,
    lastActivity,
    loadVault,
    bootstrapSessionSecurity,
  } = useStore(
    useShallow((state) => ({
      isAuthenticated: state.isAuthenticated,
      isLocked: state.isLocked,
      lockVault: state.lockVault,
      touchActivity: state.touchActivity,
      lockTimeoutMinutes: state.lockTimeoutMinutes,
      lastActivity: state.lastActivity,
      loadVault: state.loadVault,
      bootstrapSessionSecurity: state.bootstrapSessionSecurity,
    }))
  );
  const [mounted, setMounted] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const markReady = async () => {
      if (bootstrappedRef.current) {
        return;
      }

      bootstrappedRef.current = true;
      setMounted(true);
      await bootstrapSessionSecurity();
      if (!cancelled) {
        setSessionReady(true);
      }
    };

    if (useStore.persist?.hasHydrated?.()) {
      void markReady();
    }

    const unsubscribe =
      useStore.persist?.onFinishHydration?.(() => {
        void markReady();
      }) ?? (() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bootstrapSessionSecurity]);

  useEffect(() => {
    if (mounted && sessionReady && !isAuthenticated) {
      router.push("/");
    }
  }, [mounted, sessionReady, isAuthenticated, router]);

  useEffect(() => {
    if (mounted && sessionReady && isAuthenticated && !isLocked) {
      void loadVault();
    }
  }, [mounted, sessionReady, isAuthenticated, isLocked, loadVault]);

  // Auto-lock: kullanıcı etkileşimi takibi
  const handleActivity = useCallback(() => {
    if (isAuthenticated && !isLocked) {
      touchActivity();
    }
  }, [isAuthenticated, isLocked, touchActivity]);

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, handleActivity));
    return () => events.forEach((e) => window.removeEventListener(e, handleActivity));
  }, [handleActivity]);

  // Auto-lock: zamanlayıcı
  useEffect(() => {
    if (!isAuthenticated || isLocked || lockTimeoutMinutes === 0) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivity;
      const timeout = lockTimeoutMinutes * 60 * 1000;
      if (elapsed >= timeout) {
        lockVault();
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isLocked, lastActivity, lockTimeoutMinutes, lockVault]);

  useKeyboardShortcuts([
    {
      key: "k",
      ctrl: true,
      meta: true,
      enabled: mounted && sessionReady && isAuthenticated && !isLocked,
      action: () => setCommandPaletteOpen((open) => !open),
    },
    {
      key: "l",
      ctrl: true,
      meta: true,
      enabled: mounted && sessionReady && isAuthenticated && !isLocked,
      action: lockVault,
    },
  ]);

  if (!mounted || !sessionReady || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-midnight flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (isLocked) {
    return <LockScreen />;
  }

  return (
    <div className="min-h-screen bg-midnight flex">
      <BrowserExtensionBridge />
      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
      <main className={`flex-1 transition-all duration-300 ${sidebarOpen ? "ml-72" : "ml-16"}`}>
        <VaultHeader onMenuToggle={() => setSidebarOpen((open) => !open)} />
        <ErrorBoundary>
          <div className="p-6 animate-fade-in">{children}</div>
        </ErrorBoundary>
      </main>
    </div>
  );
}
