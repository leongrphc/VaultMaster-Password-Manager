import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AddItemModal from "../src/components/vault/AddItemModal";
import EditItemModal from "../src/components/vault/EditItemModal";
import LockScreen from "../src/components/vault/LockScreen";
import PlaintextExportConfirmModal from "../src/components/vault/PlaintextExportConfirmModal";
import VaultItemCard from "../src/components/vault/VaultItemCard";

const createVaultItem = vi.fn();
const updateVaultItemFull = vi.fn();
const unlockVault = vi.fn();
const logout = vi.fn();

const storeState = {
  userEmail: "user@example.com",
  unlockVault,
  logout,
  createVaultItem,
  updateVaultItemFull,
  folders: [],
  items: [],
  selectedFolderId: null,
};

vi.mock("../src/lib/store", () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock("../src/lib/notify", () => ({
  notify: {
    saved: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/lib/api", () => ({
  getErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("@vaultmaster/crypto", () => ({
  generatePassword: vi.fn(() => "generated-password"),
}));

beforeEach(() => {
  createVaultItem.mockReset();
  updateVaultItemFull.mockReset();
  unlockVault.mockReset();
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
        viewMode="list"
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
