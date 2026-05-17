"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";

type ModalProps = {
  title: ReactNode;
  titleId: string;
  children: ReactNode;
  onClose: () => void;
  descriptionId?: string;
  footer?: ReactNode;
  panelClassName?: string;
  zIndexClassName?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  isCloseBlocked?: () => boolean;
};

type ConfirmModalProps = {
  title: string;
  titleId: string;
  description: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  tone?: "danger" | "default";
  icon?: ReactNode;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal({
  title,
  titleId,
  children,
  onClose,
  descriptionId,
  footer,
  panelClassName = "max-w-lg p-6",
  zIndexClassName = "z-[70]",
  closeOnOverlayClick = true,
  closeOnEscape = true,
  isCloseBlocked,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (isCloseBlocked?.()) {
      return;
    }

    onClose();
  }, [isCloseBlocked, onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable || panel)?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const panel = panelRef.current;
      if (!panel) {
        return;
      }

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, requestClose]);

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-midnight/70 px-4 backdrop-blur-xl`}
      onMouseDown={closeOnOverlayClick ? requestClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`w-full rounded-2xl border border-border bg-abyss shadow-2xl shadow-black/40 focus:outline-none ${panelClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-text-primary">
          {title}
        </h2>
        {children}
        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  titleId,
  description,
  children,
  confirmLabel,
  cancelLabel = "Vazgeç",
  onConfirm,
  onClose,
  tone = "default",
  icon,
}: ConfirmModalProps) {
  const isDanger = tone === "danger";

  return (
    <Modal
      title={
        <span className="flex items-start gap-4">
          {icon ? (
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${isDanger ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent"}`}>
              {icon}
            </span>
          ) : null}
          <span>{title}</span>
        </span>
      }
      titleId={titleId}
      onClose={onClose}
      panelClassName={`max-w-lg p-6 ${isDanger ? "border-danger/30" : ""}`}
      zIndexClassName="z-[80]"
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${isDanger ? "bg-danger text-white hover:bg-danger/90" : "bg-accent text-midnight hover:bg-accent-dim"}`}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      {children}
      <div className={icon ? "mt-5" : "mt-3"}>{description}</div>
    </Modal>
  );
}
