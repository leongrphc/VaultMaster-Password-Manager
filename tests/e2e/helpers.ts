import { expect, type Page } from "@playwright/test";

const masterPassword = "E2e-master-password-2026!";
const itemPassword = "E2e-item-password-2026!";

export type TestAccount = {
  email: string;
  masterPassword: string;
};

export type TestLoginItem = {
  title: string;
  url: string;
  username: string;
  password: string;
};

export function createTestAccount(workerIndex: number): TestAccount {
  const unique = `${Date.now()}-${workerIndex}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e+${unique}@vaultmaster.test`,
    masterPassword,
  };
}

export function createTestLoginItem(workerIndex: number): TestLoginItem {
  const unique = `${Date.now()}-${workerIndex}`;
  return {
    title: `E2E Login ${unique}`,
    url: "https://example.com/login",
    username: `user-${unique}@example.com`,
    password: itemPassword,
  };
}

export async function registerAccount(page: Page, account: TestAccount) {
  await page.goto("/");
  await page.getByRole("button", { name: "Hesabınız yok mu? Kayıt olun" }).click();
  await page.getByLabel("E-posta").fill(account.email);
  await page.getByLabel("Ana Şifre", { exact: true }).fill(account.masterPassword);
  await page.getByLabel("Ana Şifre (Tekrar)").fill(account.masterPassword);
  await page.getByLabel(/Ana şifremi unutursam/).check();
  await page.getByRole("button", { name: /^Hesap Oluştur/ }).click();
  await expect(page).toHaveURL(/\/vault/);
  await expect(page.getByRole("button", { name: "Yeni Öğe" })).toBeVisible();
}

export async function loginAccount(page: Page, account: TestAccount) {
  await page.goto("/");
  await page.getByLabel("E-posta").fill(account.email);
  await page.getByLabel("Ana Şifre", { exact: true }).fill(account.masterPassword);
  await page.getByRole("button", { name: /^Kasayı Aç/ }).click();
  await expect(page).toHaveURL(/\/vault/);
  await expect(page.getByRole("button", { name: "Yeni Öğe" })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: /Çıkış Yap/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /^Kasayı Aç/ })).toBeVisible();
}

export async function addLoginItem(page: Page, item: TestLoginItem) {
  await page.getByRole("button", { name: "Yeni Öğe" }).click();
  await expect(page.getByRole("heading", { name: "Yeni Öğe Ekle" })).toBeVisible();
  await page.getByLabel("Başlık").fill(item.title);
  await page.getByLabel("URL").fill(item.url);
  await page.getByLabel("Kullanıcı Adı").fill(item.username);
  await page.getByLabel("Şifre", { exact: true }).fill(item.password);
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(item.title, { exact: true })).toBeVisible();
}

export async function openDataSettings(page: Page) {
  await page.goto("/vault/settings");
  await expect(page).toHaveURL(/\/vault\/settings/);
  await page.getByRole("button", { name: /Veri Yönetimi/ }).click();
  await expect(page.getByRole("heading", { name: "Dışa Aktar" })).toBeVisible();
}

type BridgeResponse<T> = {
  source: "vaultmaster-web";
  type: string;
  requestId: string;
  payload: T;
};

export async function sendBridgeRequest<T>(
  page: Page,
  type: string,
  payload: Record<string, unknown>
): Promise<BridgeResponse<T>> {
  return page.evaluate(
    ({ requestType, requestPayload }) => {
      const requestId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          reject(new Error(`Bridge response timed out for ${requestType}`));
        }, 10_000);

        function onMessage(event: MessageEvent) {
          const data = event.data;
          if (
            event.source !== window ||
            data?.source !== "vaultmaster-web" ||
            data.requestId !== requestId
          ) {
            return;
          }

          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          resolve(data);
        }

        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            source: "vaultmaster-extension",
            type: requestType,
            requestId,
            ...requestPayload,
          },
          window.location.origin
        );
      });
    },
    { requestType: type, requestPayload: payload }
  ) as Promise<BridgeResponse<T>>;
}
