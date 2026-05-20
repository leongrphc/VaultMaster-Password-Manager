import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AddItemModal from "../src/components/vault/AddItemModal";
import EditItemModal from "../src/components/vault/EditItemModal";
import LockScreen from "../src/components/vault/LockScreen";
import HealthReportPage from "../src/app/vault/health/page";
import PlaintextExportConfirmModal from "../src/components/vault/PlaintextExportConfirmModal";
import VaultItemCard from "../src/components/vault/VaultItemCard";

const createVaultItem = vi.fn();
const updateVaultItemFull = vi.fn();
const loadAttachments = vi.fn();
const uploadAttachment = vi.fn();
const downloadAttachment = vi.fn();
const deleteAttachment = vi.fn();
const unlockVault = vi.fn();
const unlockVaultLocally = vi.fn();
const getLocalUnlockStatus = vi.fn(() => ({ enabled: false }));
const logout = vi.fn();

type StoreItem = {
  id: string;
  folderId: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  data: {
    type: "login";
    title: string;
    username: string;
    password: string;
    url?: string;
  };
};

const storeState: {
  userEmail: string;
  unlockVault: typeof unlockVault;
  unlockVaultLocally: typeof unlockVaultLocally;
  getLocalUnlockStatus: typeof getLocalUnlockStatus;
  logout: typeof logout;
  createVaultItem: typeof createVaultItem;
  updateVaultItemFull: typeof updateVaultItemFull;
  loadAttachments: typeof loadAttachments;
  uploadAttachment: typeof uploadAttachment;
  downloadAttachment: typeof downloadAttachment;
  deleteAttachment: typeof deleteAttachment;
  folders: unknown[];
  items: StoreItem[];
  selectedFolderId: string | null;
} = {
  userEmail: "user@example.com",
  unlockVault,
  unlockVaultLocally,
  getLocalUnlockStatus,
  logout,
  createVaultItem,
  updateVaultItemFull,
  loadAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  folders: [],
  items: [],
  selectedFolderId: null,
};

vi.mock("../src/lib/store", () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock("../src/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    saved: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/lib/api", () => ({
  getErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("@vaultmaster/crypto", () => ({
  calculateStrength: vi.fn((password: string) => password.length >= 12 ? 85 : 35),
  generatePassword: vi.fn(() => "generated-password"),
  getStrengthLabel: vi.fn((score: number) => score >= 80 ? "strong" : "weak"),
}));

beforeEach(() => {
  createVaultItem.mockReset();
  updateVaultItemFull.mockReset();
  loadAttachments.mockReset();
  loadAttachments.mockResolvedValue(undefined);
  uploadAttachment.mockReset();
  downloadAttachment.mockReset();
  deleteAttachment.mockReset();
  unlockVault.mockReset();
  unlockVaultLocally.mockReset();
  getLocalUnlockStatus.mockReset();
  getLocalUnlockStatus.mockReturnValue({ enabled: false });
  logout.mockReset();
  storeState.userEmail = "user@example.com";
  storeState.folders = [];
  storeState.items = [];
  storeState.selectedFolderId = null;
});

describe("vault lock/unlock flow", () => {
  test("shows an error when unlock rejects the master password", async () => {
    unlockVault.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LockScreen />);

    await user.type(screen.getByLabelText("Ana Şifre"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /Kilidi Aç/i }));

    await waitFor(() => expect(unlockVault).toHaveBeenCalledWith("wrong-password", "user@example.com"));
    expect(screen.getByText("Yanlış ana şifre")).toBeInTheDocument();
  });

  test("unlocks the vault without showing an error when the password is valid", async () => {
    unlockVault.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<LockScreen />);

    await user.type(screen.getByLabelText("Ana Şifre"), "correct-password");
    await user.click(screen.getByRole("button", { name: /Kilidi Aç/i }));

    await waitFor(() => expect(unlockVault).toHaveBeenCalledWith("correct-password", "user@example.com"));
    expect(screen.queryByText("Yanlış ana şifre")).not.toBeInTheDocument();
  });
});

describe("add/edit/delete item flow", () => {
  test("creates a login item and closes the modal", async () => {
    const onClose = vi.fn();
    createVaultItem.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddItemModal onClose={onClose} />);

    await user.type(screen.getByLabelText("Başlık"), "GitHub");
    await user.type(screen.getByLabelText("URL"), "https://github.com");
    await user.type(screen.getByLabelText("Kullanıcı Adı"), "octo");
    await user.type(screen.getByLabelText("Şifre"), "secret-password");
    await user.click(screen.getByRole("button", { name: /^Kaydet/i }));

    await waitFor(() => expect(createVaultItem).toHaveBeenCalledWith(
      {
        type: "login",
        title: "GitHub",
        url: "https://github.com",
        username: "octo",
        password: "secret-password",
        totpSecret: undefined,
        notes: undefined,
        tags: undefined,
        customFields: undefined,
      },
      null
    ));
    expect(onClose).toHaveBeenCalled();
  });

  test("creates a passkey item as encrypted vault data", async () => {
    const onClose = vi.fn();
    createVaultItem.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddItemModal onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Passkey" }));
    await user.type(screen.getByLabelText("Başlık"), "GitHub Passkey");
    await user.type(screen.getByLabelText("RP ID"), "github.com");
    await user.type(screen.getByLabelText("Kullanıcı Adı"), "octo");
    await user.type(screen.getByLabelText("Credential ID"), "cred-123");
    await user.type(screen.getByLabelText("User Handle"), "user-handle-123");
    await user.type(screen.getByLabelText("Public Key"), "public-key");
    await user.type(screen.getByLabelText("Private Key"), "private-key");
    await user.type(screen.getByLabelText("Sign Count"), "7");
    await user.type(screen.getByLabelText("Transports"), "internal, hybrid");
    await user.type(screen.getByLabelText("Notlar"), "Manual passkey record");
    await user.click(screen.getByRole("button", { name: /^Kaydet/i }));

    await waitFor(() => expect(createVaultItem).toHaveBeenCalledWith(
      {
        type: "passkey",
        title: "GitHub Passkey",
        rpId: "github.com",
        credentialId: "cred-123",
        userHandle: "user-handle-123",
        username: "octo",
        publicKey: "public-key",
        privateKey: "private-key",
        signCount: 7,
        transports: ["internal", "hybrid"],
        notes: "Manual passkey record",
        tags: undefined,
        customFields: undefined,
      },
      null
    ));
    expect(onClose).toHaveBeenCalled();
  });

  test("updates an existing login item", async () => {
    const onClose = vi.fn();
    updateVaultItemFull.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <EditItemModal
        onClose={onClose}
        item={{
          id: "item-1",
          folderId: null,
          favorite: false,
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          data: {
            type: "login",
            title: "GitHub",
            url: "https://github.com",
            username: "octo",
            password: "old-password",
          },
        }}
      />
    );

    const passwordInput = screen.getByLabelText("Şifre");
    await user.clear(passwordInput);
    await user.type(passwordInput, "new-password");
    await user.click(screen.getByRole("button", { name: /^Güncelle/i }));

    await waitFor(() => expect(updateVaultItemFull).toHaveBeenCalledWith(
      "item-1",
      {
        type: "login",
        title: "GitHub",
        url: "https://github.com",
        username: "octo",
        password: "new-password",
        totpSecret: undefined,
        notes: undefined,
        tags: undefined,
        customFields: undefined,
      },
      null
    ));
    expect(onClose).toHaveBeenCalled();
  });

  test("uploads encrypted attachments from the edit modal", async () => {
    const onClose = vi.fn();
    uploadAttachment.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <EditItemModal
        onClose={onClose}
        item={{
          id: "item-attachment-1",
          folderId: null,
          favorite: false,
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          attachments: [],
          data: {
            type: "secure_note",
            title: "Private docs",
            content: "encrypted item",
          },
        }}
      />
    );

    const file = new File(["secret bytes"], "passport.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Dosya ekle"), file);

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith("item-attachment-1", file));
    expect(screen.getByText(/sunucu yalnızca ciphertext saklar/i)).toBeInTheDocument();
  });

  test("updates an existing passkey item", async () => {
    const onClose = vi.fn();
    updateVaultItemFull.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <EditItemModal
        onClose={onClose}
        item={{
          id: "item-passkey-1",
          folderId: null,
          favorite: false,
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          data: {
            type: "passkey",
            title: "GitHub Passkey",
            rpId: "github.com",
            credentialId: "cred-123",
            userHandle: "user-handle-123",
            username: "octo",
            publicKey: "public-key",
            privateKey: "old-private-key",
            signCount: 1,
            transports: ["internal"],
          },
        }}
      />
    );

    const privateKeyInput = screen.getByLabelText("Private Key");
    await user.clear(privateKeyInput);
    await user.type(privateKeyInput, "new-private-key");
    const signCountInput = screen.getByLabelText("Sign Count");
    await user.clear(signCountInput);
    await user.type(signCountInput, "2");
    await user.click(screen.getByRole("button", { name: /^Güncelle/i }));

    await waitFor(() => expect(updateVaultItemFull).toHaveBeenCalledWith(
      "item-passkey-1",
      {
        type: "passkey",
        title: "GitHub Passkey",
        rpId: "github.com",
        credentialId: "cred-123",
        userHandle: "user-handle-123",
        username: "octo",
        publicKey: "public-key",
        privateKey: "new-private-key",
        signCount: 2,
        transports: ["internal"],
        notes: undefined,
        tags: undefined,
        customFields: undefined,
      },
      null
    ));
    expect(onClose).toHaveBeenCalled();
  });

  test("shows passkey details on the item card", () => {
    render(
      <VaultItemCard
        item={{
          id: "item-passkey-1",
          folderId: null,
          favorite: false,
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          data: {
            type: "passkey",
            title: "GitHub Passkey",
            rpId: "github.com",
            credentialId: "cred-123",
            userHandle: "user-handle-123",
            username: "octo",
            publicKey: "public-key",
            privateKey: "private-key",
            signCount: 3,
            transports: ["internal", "hybrid"],
          },
        }}
        viewMode="comfortable"
        isSelected
        isPasswordRevealed={false}
        copiedId={null}
        totpState={null}
        index={0}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onTogglePassword={vi.fn()}
        onEdit={vi.fn()}
        onHistory={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("GitHub Passkey")).toBeInTheDocument();
    expect(screen.getByText("github.com")).toBeInTheDocument();
    expect(screen.getByText("cred-123")).toBeInTheDocument();
    expect(screen.getByText("internal, hybrid")).toBeInTheDocument();
    expect(screen.getByText("••••••••••")).toBeInTheDocument();
  });

  test("deletes an item from its card action", async () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <VaultItemCard
        item={{
          id: "item-1",
          folderId: null,
          favorite: false,
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          data: {
            type: "login",
            title: "GitHub",
            url: "https://github.com",
            username: "octo",
            password: "secret-password",
          },
        }}
        viewMode="comfortable"
        isSelected={false}
        isPasswordRevealed={false}
        copiedId={null}
        totpState={null}
        index={0}
        onSelect={onSelect}
        onCopy={vi.fn()}
        onTogglePassword={vi.fn()}
        onEdit={vi.fn()}
        onHistory={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole("button", { name: "Sil" }));

    expect(onDelete).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("plaintext export warning modal", () => {
  test("shows danger copy and confirms the export explicitly", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaintextExportConfirmModal
        format="CSV"
        itemCount={3}
        description="Seçili öğeler dışa aktarılacak."
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    expect(screen.getByRole("dialog", { name: /Düz metin dışa aktarma/i })).toBeInTheDocument();
    expect(screen.getByText(/VaultMaster koruması dışında kalır/i)).toBeInTheDocument();
    expect(screen.getByText("3 öğe şifrelenmemiş CSV dosyasına yazılacak.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Düz metin CSV indir" }));

    expect(onConfirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("health report breach check", () => {
  test("shows privacy copy and checks HIBP by hash prefix only", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
      new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]).buffer
    );
    const fetchMock = vi.fn().mockResolvedValue({ text: async () => "6789ABC:3" });
    vi.stubGlobal("fetch", fetchMock);
    storeState.items = [{
      id: "item-1",
      folderId: null,
      favorite: false,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
      data: {
        type: "login",
        title: "GitHub",
        username: "octo",
        password: "not-sent-password",
      },
    }];
    const user = userEvent.setup();

    render(<HealthReportPage />);

    expect(screen.getByText(/yalnızca ilk 5 hash karakteri gönderilir/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Kontrol Et/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pwnedpasswords.com/range/12345",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ));
    expect(fetchMock.mock.calls[0][0]).not.toContain("not-sent-password");
    expect(digest).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/3 kez sızdırılmış/i)).toBeInTheDocument());

    digest.mockRestore();
  });

  test("shows progress and cancels an active breach check", async () => {
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
      new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]).buffer
    );
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    storeState.items = [{
      id: "item-1",
      folderId: null,
      favorite: false,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
      data: {
        type: "login",
        title: "GitHub",
        username: "octo",
        password: "first-password",
      },
    }, {
      id: "item-2",
      folderId: null,
      favorite: false,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
      data: {
        type: "login",
        title: "GitLab",
        username: "octo",
        password: "second-password",
      },
    }];
    const user = userEvent.setup();

    render(<HealthReportPage />);

    await user.click(screen.getByRole("button", { name: /Kontrol Et/i }));
    expect(await screen.findByText("0 / 2 şifre kontrol edildi")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "İptal" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "İptal" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Kontrol Et/i })).toBeEnabled();
  });
});
