import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LoginPage from "../src/app/page";
import { api } from "../src/lib/api";

const replace = vi.fn();
const assign = vi.fn();
const setAuth = vi.fn();
const setMasterKey = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@vaultmaster/crypto", () => ({
  calculateStrength: vi.fn(() => 80),
  deriveMasterKey: vi.fn(async () => "master-key"),
  exportMasterKeyBase64: vi.fn(async () => "master-key-base64"),
  generateAuthHash: vi.fn(async () => "auth-hash"),
  getStrengthLabel: vi.fn(() => "strong"),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    auth: {
      register: vi.fn(),
      login: vi.fn(),
    },
  },
  getErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("../src/lib/notify", () => ({
  notify: {
    error: vi.fn(),
  },
}));

vi.mock("../src/lib/store", () => {
  const store = (selector: (state: unknown) => unknown) =>
    selector({
      isAuthenticated: false,
      setAuth,
      setMasterKey,
    });
  store.persist = {
    hasHydrated: () => true,
    onFinishHydration: () => () => undefined,
  };
  return { useStore: store };
});

function mockAuthResponse(email: string) {
  return {
    success: true,
    data: {
      user: { id: "user-1", email, createdAt: "2026-05-17T00:00:00.000Z" },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
      deviceId: "device-1",
      kdfSalt: "salt",
      kdfIterations: 600000,
    },
  };
}

beforeEach(() => {
  vi.mocked(api.auth.register).mockReset();
  vi.mocked(api.auth.login).mockReset();
  setAuth.mockReset();
  setMasterKey.mockReset();
  replace.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", {
    value: { assign },
    writable: true,
  });
});

describe("login/register flow", () => {
  test("register requires no-recovery acknowledgement before calling the API", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /kayıt olun/i }));
    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Ana Şifre"), "strong-password");
    await user.type(screen.getByLabelText("Ana Şifre (Tekrar)"), "strong-password");
    await user.click(screen.getByRole("button", { name: /^Hesap Oluştur/i }));

    expect(screen.getByText("Devam etmek için kurtarma olmadığını onaylamalısınız")).toBeInTheDocument();
    expect(api.auth.register).not.toHaveBeenCalled();
  });

  test("register derives credentials, stores auth state, and navigates to the vault", async () => {
    vi.mocked(api.auth.register).mockResolvedValue(mockAuthResponse("user@example.com"));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /kayıt olun/i }));
    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Ana Şifre"), "strong-password");
    await user.type(screen.getByLabelText("Ana Şifre (Tekrar)"), "strong-password");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /^Hesap Oluştur/i }));

    await waitFor(() => expect(api.auth.register).toHaveBeenCalledWith({
      email: "user@example.com",
      authHash: "auth-hash",
      kdfSalt: "user@example.com",
      kdfIterations: 600000,
    }));
    expect(setAuth).toHaveBeenCalledWith(
      { accessToken: "access-token", refreshToken: "refresh-token" },
      "user@example.com",
      "user-1",
      "device-1"
    );
    expect(setMasterKey).toHaveBeenCalledWith("master-key-base64");
    expect(assign).toHaveBeenCalledWith("/vault");
  });

  test("login handles 2FA challenge before accepting a verification code", async () => {
    vi.mocked(api.auth.login)
      .mockResolvedValueOnce({ success: true, data: { requires2FA: true } })
      .mockResolvedValueOnce(mockAuthResponse("user@example.com"));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Ana Şifre"), "strong-password");
    await user.click(screen.getByRole("button", { name: /^Kasayı Aç/i }));

    expect(await screen.findByLabelText("Doğrulama Kodu (2FA)")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Doğrulama Kodu (2FA)"), "123456");
    await user.click(screen.getByRole("button", { name: /^Doğrula/i }));

    await waitFor(() => expect(api.auth.login).toHaveBeenLastCalledWith({
      email: "user@example.com",
      authHash: "auth-hash",
      code: "123456",
      recoveryCode: undefined,
    }));
    expect(assign).toHaveBeenCalledWith("/vault");
  });
});
