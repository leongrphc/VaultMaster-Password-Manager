import { expect, test } from "@playwright/test";
import { addLoginItem, createTestAccount, createTestLoginItem, registerAccount, sendBridgeRequest } from "./helpers";

test("serves login suggestions and credentials through the extension bridge", async ({ page }, testInfo) => {
  const account = createTestAccount(testInfo.workerIndex);
  const item = createTestLoginItem(testInfo.workerIndex);

  await registerAccount(page, account);
  await addLoginItem(page, item);

  const listResponse = await sendBridgeRequest<{
    status: string;
    suggestions: Array<{ itemId: string; title: string; username: string; url: string }>;
  }>(page, "VM_LIST_LOGIN_SUGGESTIONS_REQUEST", {
    pageUrl: item.url,
    identifier: item.username,
  });

  expect(listResponse.payload.status).toBe("ready");
  const suggestion = listResponse.payload.suggestions[0];
  expect(suggestion).toMatchObject({
    title: item.title,
    username: item.username,
    url: item.url,
  });

  const credentialResponse = await sendBridgeRequest<{
    status: string;
    credential: { itemId: string; title: string; username: string; url: string; hasTotp: boolean };
  }>(page, "VM_GET_LOGIN_CREDENTIAL_REQUEST", {
    pageUrl: item.url,
    itemId: suggestion.itemId,
  });

  expect(credentialResponse.payload.status).toBe("ready");
  expect(credentialResponse.payload.credential).toMatchObject({
    itemId: suggestion.itemId,
    title: item.title,
    username: item.username,
    url: item.url,
    hasTotp: false,
  });

  const validDomainResponse = await sendBridgeRequest<{ valid: boolean; itemId?: string }>(
    page,
    "VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST",
    {
      pageUrl: item.url,
      itemId: suggestion.itemId,
    }
  );
  expect(validDomainResponse.payload.valid).toBe(true);

  const invalidDomainResponse = await sendBridgeRequest<{ valid: boolean }>(
    page,
    "VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST",
    {
      pageUrl: "https://phishing.example.net/login",
      itemId: suggestion.itemId,
    }
  );
  expect(invalidDomainResponse.payload.valid).toBe(false);
});
