import { test } from "@playwright/test";
import { addLoginItem, createTestAccount, createTestLoginItem, loginAccount, logout, registerAccount } from "./helpers";

test("registers, creates a login item, and reloads it after logout/login", async ({ page }, testInfo) => {
  const account = createTestAccount(testInfo.workerIndex);
  const item = createTestLoginItem(testInfo.workerIndex);

  await registerAccount(page, account);
  await addLoginItem(page, item);
  await logout(page);
  await loginAccount(page, account);

  await page.getByText(item.title, { exact: true }).waitFor();
});
