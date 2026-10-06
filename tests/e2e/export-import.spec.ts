import { expect, test } from "@playwright/test";
import { addLoginItem, createTestAccount, createTestLoginItem, registerAccount } from "./helpers";

test("exports and imports an encrypted JSON backup", async ({ page }, testInfo) => {
  const account = createTestAccount(testInfo.workerIndex);
  const item = createTestLoginItem(testInfo.workerIndex);

  await registerAccount(page, account);
  await addLoginItem(page, item);
  await page.getByRole("link", { name: "Ayarlar" }).click();
  await page.getByRole("button", { name: "Veri Yönetimi", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Şifreli JSON/ }).click();
  await page.getByLabel("Ana şifre", { exact: true }).fill(account.masterPassword);
  await page.getByRole("button", { name: "Doğrula ve devam et" }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("vaultmaster-backup.json");
  await download.saveAs(backupPath);

  await page.locator('input[type="file"]').last().setInputFiles(backupPath);
  await expect(page.getByText('Öğe 1: Aynı öğe — atlanacak')).toBeVisible();
  await page.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' }).click();
  await expect(page.getByText('0 öğe başarıyla içe aktarıldı')).toBeVisible();

  await page.getByRole("link", { name: /Tüm Öğeler/ }).click();
  await expect(page.getByText(item.title, { exact: true })).toBeVisible();
});
