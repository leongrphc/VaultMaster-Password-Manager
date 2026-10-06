import type { VaultItemData } from "@vaultmaster/shared";

export type CsvProvider =
  | "VaultMaster"
  | "Google Chrome"
  | "Mozilla Firefox"
  | "Bitwarden"
  | "1Password"
  | "Dashlane"
  | "LastPass";

export class CsvImportError extends Error {
  constructor(public code: "empty" | "invalid") {
    super(code);
  }
}

export interface CsvImportResult {
  provider: CsvProvider;
  items: VaultItemData[];
  skipped: number;
  records: Array<{ data: VaultItemData; folderName: string; favorite: boolean }>;
  ignoredColumns: number;
}

type HeaderMap = Map<string, number>;

interface CsvMapping {
  provider: CsvProvider;
  matches: string[];
  title: string[];
  url: string[];
  username: string[];
  password: string[];
  notes: string[];
  totpSecret: string[];
  type?: string[];
}

const MAPPINGS: CsvMapping[] = [
  {
    provider: "Bitwarden",
    matches: ["loginuri", "loginusername", "loginpassword"],
    title: ["name", "title"],
    url: ["loginuri", "uri", "url"],
    username: ["loginusername", "username"],
    password: ["loginpassword", "password"],
    notes: ["notes", "note"],
    totpSecret: ["logintotp", "totp"],
    type: ["type"],
  },
  {
    provider: "LastPass",
    matches: ["url", "username", "password", "extra", "name"],
    title: ["name", "title"],
    url: ["url"],
    username: ["username", "email", "login"],
    password: ["password"],
    notes: ["extra", "notes", "note"],
    totpSecret: ["totp", "otpsecret"],
  },
  {
    provider: "Dashlane",
    matches: ["title", "password", "otpsecret"],
    title: ["title", "name"],
    url: ["url", "website"],
    username: ["username", "username2", "email", "login"],
    password: ["password"],
    notes: ["note", "notes"],
    totpSecret: ["otpsecret", "totp"],
  },
  {
    provider: "1Password",
    matches: ["title", "website", "username", "password"],
    title: ["title", "name"],
    url: ["website", "url", "urls"],
    username: ["username", "email", "login"],
    password: ["password"],
    notes: ["notes", "notesplain", "notesplaintext", "note"],
    totpSecret: ["totp", "otpsecret"],
  },
  {
    provider: "VaultMaster",
    matches: ["title", "url", "username", "password"],
    title: ["title", "name"],
    url: ["url", "website", "uri"],
    username: ["username", "login", "email"],
    password: ["password"],
    notes: ["notes", "note"],
    totpSecret: ["totp", "otpsecret"],
  },
  {
    provider: "Google Chrome",
    matches: ["name", "url", "username", "password"],
    title: ["name", "title"],
    url: ["url"],
    username: ["username"],
    password: ["password"],
    notes: ["note", "notes"],
    totpSecret: ["totp", "otpsecret"],
  },
  {
    provider: "Mozilla Firefox",
    matches: ["url", "username", "password"],
    title: ["name", "title"],
    url: ["url", "hostname"],
    username: ["username"],
    password: ["password"],
    notes: ["notes", "note", "httprealm", "formactionorigin"],
    totpSecret: ["totp", "otpsecret"],
  },
];

export function parseVaultCsv(text: string): CsvImportResult {
  const rows = parseCsv(text.replace(/^﻿/, "")).filter((row) => row.some((cell) => cell.trim().length > 0));

  if (rows.length < 2) {
    throw new CsvImportError("empty");
  }

  if (new Set(rows[0]!.map(normalizeHeader)).size !== rows[0]!.length || rows.slice(1).some(row => row.length !== rows[0]!.length)) throw new CsvImportError("invalid");
  const headerMap = buildHeaderMap(rows[0]!);
  const mapping = detectMapping(headerMap);

  if (!mapping) {
    throw new CsvImportError("invalid");
  }

  const items: VaultItemData[] = [];
  let skipped = 0;
  const records: CsvImportResult["records"] = [];
  const supportedHeaders = new Set([...mapping.title, ...mapping.url, ...mapping.username, ...mapping.password,
    ...mapping.notes, ...mapping.totpSecret, ...(mapping.type ?? []), "folder", "grouping", "favorite", "fav", "tags"]);
  const ignoredColumns = [...headerMap.entries()].filter(([header, index]) => !supportedHeaders.has(header) && rows.slice(1).some(row => row[index]?.length)).length;

  for (const row of rows.slice(1)) {
    if (mapping.type) {
      const type = readValue(row, headerMap, mapping.type).toLowerCase();
      if (type && type !== "login") {
        skipped++;
        continue;
      }
    }

    const username = readValue(row, headerMap, mapping.username);
    const password = readValue(row, headerMap, mapping.password);

    if (!username && !password) {
      skipped++;
      continue;
    }

    const url = readValue(row, headerMap, mapping.url);
    const title = readValue(row, headerMap, mapping.title) || getHostname(url) || username || "Imported";
    const notes = readValue(row, headerMap, mapping.notes);
    const totpSecret = readValue(row, headerMap, mapping.totpSecret);

    const folderName = readValue(row, headerMap, ["folder", "grouping"]).trim();
    const favoriteValue = readValue(row, headerMap, ["favorite", "fav"]).trim().toLowerCase();
    if (folderName.length > 100 || !["", "0", "false", "1", "true"].includes(favoriteValue)) throw new CsvImportError("invalid");
    const tags = readValue(row, headerMap, ["tags"]).split(";").map(tag => tag.trim()).filter(Boolean);
    items.push({
      type: "login",
      title,
      url,
      username,
      password,
      notes,
      ...(totpSecret ? { totpSecret } : {}),
      ...(tags.length ? { tags: [...new Set(tags)] } : {}),
    });
    records.push({ data: items[items.length - 1]!, folderName, favorite: ["1", "true"].includes(favoriteValue) });
  }

  if (items.length === 0) {
    throw new CsvImportError("empty");
  }

  return { provider: mapping.provider, items, skipped, records, ignoredColumns };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;
  let closedQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (closedQuote && ![",", "\n", "\r"].includes(char!)) throw new CsvImportError("invalid");
    if (char === '"') {
      if (current.length) throw new CsvImportError("invalid");
      inQuotes = true;
    } else if (char === ",") {
      row.push(current);
      current = "";
      closedQuote = false;
    } else if (char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      closedQuote = false;
    } else if (char !== "\r") {
      current += char;
    }
  }

  if (inQuotes) throw new CsvImportError("invalid");
  row.push(current);
  rows.push(row);

  return rows;
}

function buildHeaderMap(headers: string[]): HeaderMap {
  const map: HeaderMap = new Map();

  headers.forEach((header, index) => {
    map.set(normalizeHeader(header), index);
  });

  return map;
}

function detectMapping(headerMap: HeaderMap): CsvMapping | null {
  return MAPPINGS.find((mapping) =>
    mapping.matches.every((header) => headerMap.has(header))
  ) ?? null;
}

function readValue(row: string[], headerMap: HeaderMap, aliases: string[]): string {
  for (const alias of aliases) {
    const index = headerMap.get(alias);
    if (index === undefined) continue;

    const value = row[index];
    if (value) return value;
  }

  return "";
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getHostname(value: string): string {
  if (!value) return "";

  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return value;
  }
}
