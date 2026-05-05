"use client";

import { useEffect } from "react";

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  preventDefault?: boolean;
  enabled?: boolean;
  action: (event: KeyboardEvent) => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      for (const shortcut of shortcuts) {
        if (shortcut.enabled === false) continue;
        if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) continue;
        if (Boolean(shortcut.shift) !== event.shiftKey) continue;
        if (Boolean(shortcut.alt) !== event.altKey) continue;

        const ctrlMatches = shortcut.ctrl ? event.ctrlKey : true;
        const metaMatches = shortcut.meta ? event.metaKey : true;
        const needsModifier = shortcut.ctrl || shortcut.meta;
        const modifierMatches = needsModifier ? ctrlMatches || metaMatches : !event.ctrlKey && !event.metaKey;
        if (!modifierMatches) continue;
        if (isEditable && !needsModifier && shortcut.key !== "Escape") continue;

        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        shortcut.action(event);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts]);
}
