import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ImportReviewPanel from "../src/components/vault/ImportReviewPanel";
import type { RestoreBackupInput } from "@vaultmaster/shared";
import type { ImportReview } from "../src/lib/import-conflicts";
const date = "2026-10-06T00:00:00.000Z";
function fixture(): ImportReview {
  return { emptyFolderIds: [], rows: [{ index: 0, kind: "same-login", target: "00000000-0000-4000-8000-000000000001", replaceAllowed: true }],
    body: { backupId: "00000000-0000-4000-8000-000000000002", snapshot: { folders: [], items: [{ id: "00000000-0000-4000-8000-000000000003", encryptedData: "ciphertext", iv: "iv", folderId: null, favorite: false, deletedAt: null, createdAt: date, updatedAt: date, versions: [], attachments: [] }] },
      review: { state: "a".repeat(64), replacements: {}, folderMap: {}, overwriteApproved: false } } };
}
test("overwrite requires a separate checkbox; changing the decision revokes approval", async () => {
  const commit = vi.fn(async (body: RestoreBackupInput) => { void body; }), cancel = vi.fn();
  render(<ImportReviewPanel review={fixture()} busy={false} commit={commit} cancel={cancel} />);
  const button = screen.getByRole("button", { name: "İncelemeyi Onayla ve İçe Aktar" });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "replace" } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "keep-both" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "replace" } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0]![0].review!.overwriteApproved).toBe(true);
});
test("failed requests show a fixed secret-free error and retry exactly the same reviewed body", async () => {
  const commit = vi.fn().mockRejectedValueOnce(new Error("SECRET-MUST-NOT-RENDER")).mockResolvedValueOnce(undefined);
  const cancel = vi.fn();
  render(<ImportReviewPanel review={fixture()} busy={false} commit={commit} cancel={cancel} />);
  fireEvent.click(screen.getByRole("button", { name: "İncelemeyi Onayla ve İçe Aktar" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(screen.queryByText(/SECRET-MUST-NOT-RENDER/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "İncelemeyi Onayla ve İçe Aktar" }));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(commit.mock.calls[0]![0]).toEqual(commit.mock.calls[1]![0]);
  fireEvent.click(screen.getByRole("button", { name: "İptal" }));
  expect(cancel).toHaveBeenCalledOnce();
});
