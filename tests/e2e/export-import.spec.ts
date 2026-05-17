import { expect, test } from "@playwright/test";
import { addLoginItem, createTestAccount, createTestLoginItem, openDataSettings, registerAccount } from "./helpers";

test("exports and imports an encrypted JSON backup", async ({ page }, testInfo) => {
  const account = createTestAccount(testInfo.workerIndex);
  const item = createTestLoginItem(testInfo.workerIndex);

  await registerAccount(page, account);
  await addLoginItem(page, item);
  await openDataSettings(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Şifreli JSON/ }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("vaultmaster-backup.json");
  await download.saveAs(backupPath);

  await page.locator('input[type="file"]').setInputFiles(backupPath);
  await expect(page.getByText(/öğe başarıyla içe aktarıldı \(JSON\)/)).toBeVisible();

  await page.goto("/vault");
  await expect(page.getByText(item.title, { exact: true })).toBeVisible();
});
