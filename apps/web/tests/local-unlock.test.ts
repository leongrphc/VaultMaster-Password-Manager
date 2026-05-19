import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearLocalUnlock,
  getLocalUnlockStatus,
  isLocalUnlockSupported,
  setupLocalUnlock,
  unlockWithLocalAuthenticator,
} from "../src/lib/local-unlock";

const prfBytes = new Uint8Array(32).fill(7).buffer;
let storedPrfSalt: Uint8Array | null = null;

describe("local unlock helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    storedPrfSalt = null;
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(window, "PublicKeyCredential", {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      value: window.PublicKeyCredential,
      configurable: true,
    });
    Object.defineProperty(navigator, "credentials", {
      value: {
        create: vi.fn(),
        get: vi.fn(),
      },
      configurable: true,
    });

    vi.mocked(navigator.credentials.create).mockImplementation(async (options) => {
      const publicKey = (options as CredentialCreationOptions).publicKey;
      const extensions = publicKey?.extensions as { prf?: { eval?: { first?: Uint8Array } } } | undefined;
      storedPrfSalt = extensions?.prf?.eval?.first ?? null;

      return {
        rawId: new Uint8Array([1, 2, 3]).buffer,
        getClientExtensionResults: () => ({
          prf: {
            enabled: true,
            results: { first: prfBytes },
          },
        }),
      } as PublicKeyCredential;
    });

    vi.mocked(navigator.credentials.get).mockImplementation(async (options) => {
      const publicKey = (options as CredentialRequestOptions).publicKey;
      const extensions = publicKey?.extensions as { prf?: { eval?: { first?: Uint8Array } } } | undefined;
      expect(Array.from(extensions?.prf?.eval?.first ?? [])).toEqual(Array.from(storedPrfSalt ?? []));

      return {
        rawId: new Uint8Array([1, 2, 3]).buffer,
        getClientExtensionResults: () => ({
          prf: {
            results: { first: prfBytes },
          },
        }),
      } as PublicKeyCredential;
    });
  });

  test("reports support only in a secure WebAuthn-capable browser", () => {
    expect(isLocalUnlockSupported()).toBe(true);
  });

  test("stores encrypted local unlock material and restores the master key", async () => {
    const status = await setupLocalUnlock({
      masterKeyBase64: "test-master-key",
      userEmail: "user@example.com",
      userId: "user-1",
    });

    expect(status.enabled).toBe(true);
    expect(localStorage.getItem("vaultmaster-local-unlock")).not.toContain("test-master-key");
    await expect(unlockWithLocalAuthenticator()).resolves.toBe("test-master-key");
  });

  test("clears local unlock material", async () => {
    await setupLocalUnlock({
      masterKeyBase64: "test-master-key",
      userEmail: "user@example.com",
      userId: "user-1",
    });

    clearLocalUnlock();
    expect(getLocalUnlockStatus().enabled).toBe(false);
    await expect(unlockWithLocalAuthenticator()).rejects.toThrow("ayarlı değil");
  });
});
