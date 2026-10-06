import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import OfflineSnapshotCleanup from "../src/components/vault/OfflineSnapshotCleanup";
import { useStore } from "../src/lib/store";

const snapshotKey = "vaultmaster-offline-snapshot";
const retained = ["vaultmaster-auth", "vaultmaster-lock-verifier", "vaultmaster-local-unlock", "fixture-backup-state", "unrelated"];
const secret = "fixture-secret-do-not-render";
beforeEach(() => {
  localStorage.clear();
  useStore.setState({ isAuthenticated: true, isLocked: false, masterKeyBase64: "memory-key", userId: "fixture-user" });
  localStorage.setItem(snapshotKey, secret);
  for (const key of retained) localStorage.setItem(key, secret);
});
const open = () => fireEvent.click(screen.getByRole("button", { name: "Çevrimdışı Kopyayı Kaldır" }));
const approve = () => fireEvent.click(screen.getByRole("button", { name: "Yalnızca Çevrimdışı Kopyayı Kaldır" }));

test("explicit approval removes only the snapshot, repeat is harmless and UI is secret-free", () => {
  render(<OfflineSnapshotCleanup />);
  open();
  expect(localStorage.getItem(snapshotKey)).toBe(secret);
  expect(screen.getByRole("dialog")).not.toHaveTextContent(secret);
  approve();
  expect(localStorage.getItem(snapshotKey)).toBeNull();
  for (const key of retained) expect(localStorage.getItem(key)).toBe(secret);
  expect(useStore.getState().masterKeyBase64).toBe("memory-key");
  expect(screen.getByRole("status")).not.toHaveTextContent(secret);
  open(); approve();
  expect(localStorage.getItem(snapshotKey)).toBeNull();
});

for (const cancellation of ["button", "escape", "unmount", "lock", "account"] as const) {
  test(`${cancellation} abandons approval without deleting anything`, () => {
    const view = render(<OfflineSnapshotCleanup />);
    open();
    if (cancellation === "button") fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    if (cancellation === "escape") fireEvent.keyDown(document, { key: "Escape" });
    if (cancellation === "unmount") { view.unmount(); render(<OfflineSnapshotCleanup />); }
    if (cancellation === "lock" || cancellation === "account") {
      const oldButton = screen.getByRole("button", { name: "Yalnızca Çevrimdışı Kopyayı Kaldır" });
      act(() => useStore.setState(cancellation === "lock" ? { isLocked: true, masterKeyBase64: null } : { userId: "another-user" }));
      fireEvent.click(oldButton);
    }
    expect(localStorage.getItem(snapshotKey)).toBe(secret);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
}

test("storage failure uses fixed error text and a fresh approval can recover", () => {
  render(<OfflineSnapshotCleanup />);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => { throw new Error(secret); });
  open(); approve();
  expect(localStorage.getItem(snapshotKey)).toBe(secret);
  expect(screen.getByRole("alert")).not.toHaveTextContent(secret);
  expect(log).not.toHaveBeenCalled();
  remove.mockRestore(); log.mockRestore();
  open(); approve();
  expect(localStorage.getItem(snapshotKey)).toBeNull();
});
