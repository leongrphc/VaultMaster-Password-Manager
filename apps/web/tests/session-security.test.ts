import { beforeEach, expect, test, vi } from "vitest";
import { useStore } from "../src/lib/store";
import { api } from "../src/lib/api";
import { persistOfflineVaultSnapshot, readOfflineVaultSnapshot, verifyLockVerifier } from "../src/lib/offline-cache";
import { unlockWithLocalAuthenticator } from "../src/lib/local-unlock";

vi.mock("../src/lib/api", () => ({
  api: {
    auth: { refresh: vi.fn(), getVaultKey: vi.fn(async () => ({ data: { vaultKeyEnvelope: null } })) },
    vault: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), getAttachments: vi.fn(), getAttachment: vi.fn() },
    folders: { getAll: vi.fn() },
  },
  ApiError: class extends Error { status = 0; },
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
  isUnauthorizedError: () => false,
}));
vi.mock("@vaultmaster/crypto", () => ({
  deriveMasterKey: vi.fn(async () => "key"),
  exportMasterKeyBase64: vi.fn(async () => "memory-only-key"),
  importMasterKey: vi.fn(async () => "key"),
  encryptJSON: vi.fn(async () => ({ ciphertext: "ciphertext", iv: "iv" })),
  decryptJSON: vi.fn(async () => ({ type: "login", title: "Fixture", username: "octo", password: "fixture-secret" })),
  encryptBinary: vi.fn(), decryptBinary: vi.fn(async () => new ArrayBuffer(0)),
}));
vi.mock("../src/lib/offline-cache", () => ({
  persistLockVerifier: vi.fn(async () => true),
  verifyLockVerifier: vi.fn(async () => true),
  persistOfflineVaultSnapshot: vi.fn(async () => "2026-10-05"),
  readOfflineVaultSnapshot: vi.fn(async () => null),
  clearLockVerifier: vi.fn(), clearOfflineVaultSnapshot: vi.fn(),
}));
vi.mock("../src/lib/local-unlock", () => ({
  clearLocalUnlock: vi.fn(), getLocalUnlockStatus: vi.fn(), setupLocalUnlock: vi.fn(),
  unlockWithLocalAuthenticator: vi.fn(async () => "memory-only-key"),
}));
vi.mock("../src/lib/notify", () => ({ notify: { error: vi.fn(), sessionExpired: vi.fn(), offlineMode: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tokens = { accessToken: "access", refreshToken: "refresh" };
const encryptedItem = { id: "item-1", encryptedData: "ciphertext", iv: "iv", folderId: null, favorite: false, createdAt: "2026-10-05", updatedAt: "2026-10-05" };
function login() {
  useStore.getState().setAuth(tokens, "user@example.test", "user-1");
  useStore.getState().setMasterKey("memory-only-key");
}
beforeEach(() => {
  useStore.getState().logout();
  localStorage.clear(); sessionStorage.clear();
  vi.clearAllMocks();
  vi.mocked(api.vault.getAll).mockResolvedValue({ data: [encryptedItem] });
  vi.mocked(api.folders.getAll).mockResolvedValue({ data: [] });
  vi.mocked(verifyLockVerifier).mockResolvedValue(true);
  vi.mocked(readOfflineVaultSnapshot).mockResolvedValue(null);
});

test("keeps the vault key in memory, removes legacy storage and preserves it on client navigation", async () => {
  sessionStorage.setItem("vaultmaster-session-master-key", "legacy-plaintext-key");
  login();
  await useStore.getState().bootstrapSessionSecurity();
  expect(useStore.getState().masterKeyBase64).toBe("memory-only-key");
  expect(sessionStorage.getItem("vaultmaster-session-master-key")).toBeNull();
  expect(localStorage.getItem("vaultmaster-auth")).not.toContain("memory-only-key");
  expect(useStore.getState().isLocked).toBe(false);
});

for (const version of [1, 3, 4]) {
  test(`restores an authenticated but locked session from persisted version ${version}`, async () => {
    localStorage.setItem("vaultmaster-auth", JSON.stringify({ version, state: {
      isAuthenticated: true, userId: "user-1", userEmail: "user@example.test", tokens,
      masterKeyBase64: "legacy-key", isLocked: false,
      items: [{ data: { password: "legacy-plaintext" } }],
    } }));
    sessionStorage.setItem("vaultmaster-session-master-key", "legacy-key");
    await useStore.persist.rehydrate();
    await useStore.getState().bootstrapSessionSecurity();
    expect(useStore.getState().isAuthenticated).toBe(true);
    expect(useStore.getState().tokens).toEqual(tokens);
    expect(useStore.getState().isLocked).toBe(true);
    expect(useStore.getState().masterKeyBase64).toBeNull();
    expect(useStore.getState().items).toEqual([]);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("vaultmaster-auth")).not.toContain("legacy-key");
  });
}

for (const action of ["lock", "logout", "lock-unlock", "switch-account"]) {
  test(`discards a pending vault load after ${action}`, async () => {
    login();
    const response = deferred<{ data: typeof encryptedItem[] }>();
    vi.mocked(api.vault.getAll).mockReturnValue(response.promise);
    const loading = useStore.getState().loadVault();
    await vi.waitFor(() => expect(api.vault.getAll).toHaveBeenCalled());
    if (action === "logout") useStore.getState().logout();
    else useStore.getState().lockVault();
    if (action === "lock-unlock") useStore.getState().setMasterKey("memory-only-key");
    if (action === "switch-account") {
      useStore.getState().setAuth({ accessToken: "other", refreshToken: "other" }, "other@example.test", "user-2");
      useStore.getState().setMasterKey("other-key");
    }
    response.resolve({ data: [encryptedItem] });
    await loading;
    expect(useStore.getState().items).toEqual([]);
    expect(useStore.getState().isLoading).toBe(false);
    expect(persistOfflineVaultSnapshot).not.toHaveBeenCalled();
  });
}

test("discards an offline fallback completing after lock", async () => {
  login();
  vi.mocked(api.vault.getAll).mockRejectedValue(new Error("offline"));
  const snapshot = deferred<Awaited<ReturnType<typeof readOfflineVaultSnapshot>>>();
  vi.mocked(readOfflineVaultSnapshot).mockReturnValue(snapshot.promise);
  const loading = useStore.getState().loadVault();
  await vi.waitFor(() => expect(readOfflineVaultSnapshot).toHaveBeenCalled());
  useStore.getState().lockVault();
  snapshot.resolve({ savedAt: "2026-10-05", folders: [], items: [{ ...encryptedItem, data: { type: "login", title: "Fixture", username: "octo", password: "fixture-secret" } }] });
  await loading;
  expect(useStore.getState().items).toEqual([]);
  expect(useStore.getState().isLocked).toBe(true);
});

for (const local of [false, true]) {
  test(`a delayed ${local ? "biometric" : "password"} unlock cannot override a new lock`, async () => {
    login(); useStore.getState().lockVault();
    const verification = deferred<boolean>();
    vi.mocked(verifyLockVerifier).mockReturnValue(verification.promise);
    const unlocking = local ? useStore.getState().unlockVaultLocally() : useStore.getState().unlockVault("password", "user@example.test");
    await vi.waitFor(() => expect(verifyLockVerifier).toHaveBeenCalled());
    useStore.getState().lockVault();
    verification.resolve(true);
    expect(await unlocking).toBe(false);
    expect(useStore.getState().masterKeyBase64).toBeNull();
    if (local) expect(unlockWithLocalAuthenticator).toHaveBeenCalled();
  });
}

test("a completed create request cannot put plaintext back into a locked vault", async () => {
  login();
  const response = deferred<{ data: typeof encryptedItem }>();
  vi.mocked(api.vault.create).mockReturnValue(response.promise);
  const saving = useStore.getState().createVaultItem({ type: "login", title: "Fixture", username: "octo", password: "fixture-secret" });
  const rejection = expect(saving).rejects.toThrow(/Kasa kilitlendi/);
  await vi.waitFor(() => expect(api.vault.create).toHaveBeenCalled());
  useStore.getState().lockVault();
  response.resolve({ data: encryptedItem });
  await rejection;
  expect(useStore.getState().items).toEqual([]);
});

test("a late refresh cannot restore tokens after logout", async () => {
  login();
  const response = deferred<{ data: { tokens: typeof tokens } }>();
  vi.mocked(api.auth.refresh).mockReturnValue(response.promise);
  const refreshing = useStore.getState().refreshAuthTokens();
  useStore.getState().logout();
  response.resolve({ data: { tokens: { accessToken: "late-access", refreshToken: "late-refresh" } } });
  expect(await refreshing).toBeNull();
  expect(useStore.getState().tokens).toBeNull();
});
