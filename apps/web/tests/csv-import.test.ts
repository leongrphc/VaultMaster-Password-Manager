import { describe, expect, it } from "vitest";
import { CsvImportError, parseVaultCsv } from "../src/lib/csv-import";

function firstItem(csv: string) {
  return parseVaultCsv(csv).items[0];
}

describe("parseVaultCsv", () => {
  it("maps VaultMaster CSV", () => {
    const result = parseVaultCsv('title,url,username,password,notes\nExample,https://example.com,user,secret,"note text"');

    expect(result.provider).toBe("VaultMaster");
    expect(result.items[0]).toMatchObject({
      type: "login",
      title: "Example",
      url: "https://example.com",
      username: "user",
      password: "secret",
      notes: "note text",
    });
  });

  it("maps Chrome CSV", () => {
    const item = firstItem("name,url,username,password\nExample,https://example.com,user,secret");

    expect(item).toMatchObject({ title: "Example", url: "https://example.com", username: "user", password: "secret" });
  });

  it("maps Firefox CSV and derives a title from URL", () => {
    const item = firstItem("url,username,password,httpRealm,formActionOrigin\nexample.com/login,user,secret,realm,origin");

    expect(item).toMatchObject({ title: "example.com", url: "example.com/login", username: "user", password: "secret" });
  });

  it("maps Bitwarden login fields and skips non-login rows", () => {
    const result = parseVaultCsv("folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nWork,0,login,Example,note,,,https://example.com,user,secret,JBSWY3DPEHPK3PXP\nWork,0,note,Secure Note,note,,,,,,");

    expect(result.provider).toBe("Bitwarden");
    expect(result.skipped).toBe(1);
    expect(result.items[0]).toMatchObject({
      title: "Example",
      url: "https://example.com",
      username: "user",
      password: "secret",
      notes: "note",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("maps 1Password CSV", () => {
    const result = parseVaultCsv("Title,Website,Username,Password,Notes\nExample,https://example.com,user,secret,note");

    expect(result.provider).toBe("1Password");
    expect(result.items[0]).toMatchObject({ title: "Example", url: "https://example.com", username: "user", password: "secret", notes: "note" });
  });

  it("maps Dashlane CSV", () => {
    const result = parseVaultCsv("title,url,username,password,note,otpSecret\nExample,https://example.com,user,secret,note,JBSWY3DPEHPK3PXP");

    expect(result.provider).toBe("Dashlane");
    expect(result.items[0]).toMatchObject({ title: "Example", url: "https://example.com", username: "user", password: "secret", notes: "note", totpSecret: "JBSWY3DPEHPK3PXP" });
  });

  it("maps LastPass CSV", () => {
    const result = parseVaultCsv("url,username,password,extra,name,grouping,fav\nhttps://example.com,user,secret,note,Example,Work,0");

    expect(result.provider).toBe("LastPass");
    expect(result.items[0]).toMatchObject({ title: "Example", url: "https://example.com", username: "user", password: "secret", notes: "note" });
  });

  it("parses quoted commas, escaped quotes, CRLF, BOM, and multiline notes", () => {
    const result = parseVaultCsv('﻿title,url,username,password,notes\r\n"Example, Inc.",https://example.com,user,secret,"first line\nsecond ""quoted"" line"');

    expect(result.items[0]).toMatchObject({
      title: "Example, Inc.",
      notes: 'first line\nsecond "quoted" line',
    });
  });

  it("throws a typed error for unsupported CSV", () => {
    expect(() => parseVaultCsv("foo,bar\n1,2")).toThrow(CsvImportError);
  });
});
