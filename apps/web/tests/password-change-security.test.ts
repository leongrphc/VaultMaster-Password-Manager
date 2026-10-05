import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createVaultKey, deriveMasterKey, wrapVaultKey, unwrapVaultKey, exportMasterKeyBase64 } from "@vaultmaster/crypto";
import { useStore } from "../src/lib/store";
import { api, ApiError } from "../src/lib/api";
import { persistLockVerifier } from "../src/lib/offline-cache";

vi.mock("../src/lib/api", async importOriginal => {
  const original = await importOriginal<typeof import("../src/lib/api")>();
  return { ...original, api: { auth: { changePassword: vi.fn(), getVaultKey: vi.fn(), refresh: vi.fn() },
    vault: { getAll: vi.fn(async () => ({ data: [] })) }, folders: { getAll: vi.fn(async () => ({ data: [] })) } } };
});
vi.mock("../src/lib/notify", () => ({ notify: { error: vi.fn(), sessionExpired: vi.fn() } }));

const email = "password-fixture@example.test";
const tokens = { accessToken: "access", refreshToken: "refresh" };
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  useStore.getState().logout();
  localStorage.clear();
  vi.mocked(api.auth.changePassword).mockReset();
  vi.mocked(api.auth.getVaultKey).mockReset();
});
afterEach(() => { useStore.getState().logout(); vi.unstubAllGlobals(); });

async function session(legacy: boolean) {
  const passwordKey = await deriveMasterKey("old-password", email);
  const key = legacy ? passwordKey : await createVaultKey();
  const envelope = legacy ? null : { ...await wrapVaultKey(key, passwordKey), version: 1 };
  const keyBase64 = await exportMasterKeyBase64(key);
  useStore.getState().setAuth(tokens, email, "user-1", "device-1", envelope);
  useStore.getState().setMasterKey(keyBase64);
  await persistLockVerifier(keyBase64);
  vi.mocked(api.auth.changePassword).mockResolvedValue({ success: true });
  vi.mocked(api.auth.getVaultKey).mockImplementation(async () => ({ data: { vaultKeyEnvelope: useStore.getState().vaultKeyEnvelope } }));
  return { keyBase64, envelope };
}

for (const legacy of [true, false]) {
  test(`changes ${legacy ? "legacy" : "wrapped"} passwords and unlocks online and offline without changing the data key`, async () => {
    const { keyBase64 } = await session(legacy);
    await useStore.getState().changeMasterPassword("old-password", "new-password");
    expect(useStore.getState().masterKeyBase64).toBe(keyBase64);
    const envelope = useStore.getState().vaultKeyEnvelope!;
    expect(envelope.version).toBe(legacy ? 1 : 2);
    expect(localStorage.getItem("vaultmaster-auth")).not.toContain(keyBase64);
    const newKey = await deriveMasterKey("new-password", email);
    expect(await exportMasterKeyBase64(await unwrapVaultKey(envelope, newKey))).toBe(keyBase64);
    expect(vi.mocked(api.auth.changePassword).mock.calls[0][0]).not.toHaveProperty("items");
    useStore.getState().lockVault();
    expect(await useStore.getState().unlockVault("old-password", email)).toBe(false);
    expect(await useStore.getState().unlockVault("new-password", email)).toBe(true);
    useStore.getState().lockVault();
    vi.mocked(api.auth.getVaultKey).mockRejectedValue(new ApiError("Offline", 0));
    expect(await useStore.getState().unlockVault("old-password", email)).toBe(false);
    expect(await useStore.getState().unlockVault("new-password", email)).toBe(true);
  });
}

test("wrong current password and failed API writes preserve the original envelope", async () => {
  const { keyBase64, envelope } = await session(false);
  await expect(useStore.getState().changeMasterPassword("wrong-password", "new-password")).rejects.toThrow();
  expect(api.auth.changePassword).not.toHaveBeenCalled();
  vi.mocked(api.auth.changePassword).mockRejectedValue(new ApiError("Conflict", 409));
  await expect(useStore.getState().changeMasterPassword("old-password", "new-password")).rejects.toThrow();
  expect(useStore.getState().vaultKeyEnvelope).toEqual(envelope);
  expect(useStore.getState().masterKeyBase64).toBe(keyBase64);
});

for (const action of ["lock", "switch-account"]) {
  test(`password change completion after ${action} never restores plaintext or overwrites another account`, async () => {
    await session(false);
    let finish!: (value: unknown) => void;
    vi.mocked(api.auth.changePassword).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = useStore.getState().changeMasterPassword("old-password", "new-password");
    await vi.waitFor(() => expect(api.auth.changePassword).toHaveBeenCalled());
    useStore.getState().lockVault();
    if (action === "switch-account") useStore.getState().setAuth(tokens, "other@example.test", "user-2", "device-2");
    finish({ success: true });
    await pending;
    expect(useStore.getState().isLocked).toBe(true);
    expect(useStore.getState().masterKeyBase64).toBeNull();
    expect(useStore.getState().items).toEqual([]);
    expect(useStore.getState().vaultKeyEnvelope?.version ?? null).toBe(action === "lock" ? 2 : null);
  });
}

test("lost change response is recovered from server metadata; server errors never enable offline unlock", async () => {
  const { envelope } = await session(false);
  const key = await unwrapVaultKey(envelope!, await deriveMasterKey("old-password", email));
  const latest = { ...await wrapVaultKey(key, await deriveMasterKey("new-password", email)), version: 2 };
  useStore.getState().lockVault();
  vi.mocked(api.auth.getVaultKey).mockResolvedValue({ data: { vaultKeyEnvelope: latest } });
  expect(await useStore.getState().unlockVault("old-password", email)).toBe(false);
  expect(useStore.getState().vaultKeyEnvelope).toEqual(latest);
  expect(await useStore.getState().unlockVault("new-password", email)).toBe(true);
  useStore.getState().lockVault();
  vi.mocked(api.auth.getVaultKey).mockRejectedValue(new ApiError("Server failure", 500));
  expect(await useStore.getState().unlockVault("new-password", email)).toBe(false);
  expect(useStore.getState().isLocked).toBe(true);
});
