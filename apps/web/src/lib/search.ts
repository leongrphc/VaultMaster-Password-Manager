import type { DecryptedVaultItem } from "./store";
import type { VaultItemType } from "@vaultmaster/shared";

type FieldName = "username" | "url" | "tag" | "note";

interface ParsedSearchQuery {
  text: string[];
  fields: { field: FieldName; value: string }[];
  types: VaultItemType[];
  favorite?: boolean;
  hasTotp?: boolean;
  hasCustom?: boolean;
}

const typeAliases: Record<string, VaultItemType> = {
  login: "login",
  note: "secure_note",
  secure_note: "secure_note",
  card: "credit_card",
  credit_card: "credit_card",
  identity: "identity",
};

const fieldAliases: Record<string, FieldName> = {
  username: "username",
  user: "username",
  url: "url",
  site: "url",
  tag: "tag",
  note: "note",
  notes: "note",
};

export function searchVaultItems(items: DecryptedVaultItem[], input: string) {
  const query = parseSearchQuery(input);
  if (!hasActiveQuery(query)) {
    return items;
  }

  return items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((result) => result.item);
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const fields: ParsedSearchQuery["fields"] = [];
  const types: VaultItemType[] = [];
  const text: string[] = [];
  let favorite: boolean | undefined;
  let hasTotp: boolean | undefined;
  let hasCustom: boolean | undefined;

  for (const token of tokenize(input)) {
    const fieldMatch = token.match(/^@(\w+):(.+)$/);
    if (fieldMatch) {
      const field = fieldAliases[fieldMatch[1].toLowerCase()];
      if (field) {
        fields.push({ field, value: normalize(fieldMatch[2]) });
        continue;
      }
    }

    const operatorMatch = token.match(/^(type|favorite|has):(.+)$/i);
    if (operatorMatch) {
      const operator = operatorMatch[1].toLowerCase();
      const value = operatorMatch[2].toLowerCase();

      if (operator === "type" && typeAliases[value]) {
        types.push(typeAliases[value]);
        continue;
      }

      if (operator === "favorite") {
        favorite = ["true", "yes", "1", "evet"].includes(value);
        continue;
      }

      if (operator === "has") {
        if (value === "totp" || value === "2fa") {
          hasTotp = true;
          continue;
        }
        if (value === "custom" || value === "field" || value === "fields") {
          hasCustom = true;
          continue;
        }
      }
    }

    const normalized = normalize(token);
    if (normalized) {
      text.push(normalized);
    }
  }

  return { text, fields, types, favorite, hasTotp, hasCustom };
}

export function getSearchHelp(input: string) {
  if (input.trim().startsWith("@")) {
    return ["@username:mustafa", "@url:github", "@tag:work", "@note:server"];
  }

  if (input.trim().includes(":")) {
    return ["type:login", "favorite:true", "has:totp", "has:custom"];
  }

  return ["github type:login", "@url:bank favorite:true", "has:totp", "type:card"];
}

function scoreItem(item: DecryptedVaultItem, query: ParsedSearchQuery) {
  if (query.types.length > 0 && !query.types.includes(item.data.type)) return 0;
  if (query.favorite !== undefined && item.favorite !== query.favorite) return 0;
  if (query.hasTotp && (item.data.type !== "login" || !item.data.totpSecret)) return 0;
  if (query.hasCustom && !(item.data.customFields || []).length) return 0;

  let score = 1;

  for (const field of query.fields) {
    const fieldScore = scoreField(item, field.field, field.value);
    if (fieldScore === 0) return 0;
    score += fieldScore;
  }

  for (const text of query.text) {
    const textScore = scoreText(item, text);
    if (textScore === 0) return 0;
    score += textScore;
  }

  return score;
}

function scoreField(item: DecryptedVaultItem, field: FieldName, value: string) {
  if (field === "username") {
    return item.data.type === "login" ? scoreValue(item.data.username, value, 12) : 0;
  }

  if (field === "url") {
    return item.data.type === "login" ? scoreValue(item.data.url || "", value, 12) : 0;
  }

  if (field === "tag") {
    return Math.max(...(item.data.tags || []).map((tag) => scoreValue(tag, value, 10)), 0);
  }

  const noteValue = getNoteValue(item);
  return scoreValue(noteValue, value, 8);
}

function scoreText(item: DecryptedVaultItem, text: string) {
  const values = getSearchableValues(item);
  return Math.max(...values.map(({ value, weight }) => scoreValue(value, text, weight)), 0);
}

function scoreValue(value: string, query: string, weight: number) {
  const normalized = normalize(value);
  if (!normalized || !query) return 0;
  if (normalized === query) return weight + 8;
  if (normalized.startsWith(query)) return weight + 5;
  if (normalized.includes(query)) return weight;
  if (isFuzzyMatch(normalized, query)) return Math.max(1, weight - 4);
  return 0;
}

function getSearchableValues(item: DecryptedVaultItem) {
  const data = item.data;
  const values: { value: string; weight: number }[] = [
    { value: data.title, weight: 14 },
    ...(data.tags || []).map((tag) => ({ value: tag, weight: 9 })),
    ...(data.customFields || []).flatMap((field) => [
      { value: field.label, weight: 5 },
      { value: field.value, weight: 4 },
    ]),
  ];

  if (data.type === "login") {
    values.push(
      { value: data.username, weight: 10 },
      { value: data.url || "", weight: 10 },
      { value: data.notes || "", weight: 4 }
    );
  } else if (data.type === "secure_note") {
    values.push({ value: data.content, weight: 5 });
  } else if (data.type === "credit_card") {
    values.push(
      { value: data.cardholderName, weight: 9 },
      { value: data.notes || "", weight: 4 }
    );
  } else {
    values.push(
      { value: data.fullName, weight: 10 },
      { value: data.email || "", weight: 9 },
      { value: data.phone || "", weight: 7 },
      { value: data.organization || "", weight: 7 },
      { value: data.address || "", weight: 5 },
      { value: data.notes || "", weight: 4 }
    );
  }

  return values;
}

function getNoteValue(item: DecryptedVaultItem) {
  const data = item.data;
  if (data.type === "secure_note") return data.content;
  if (data.type === "login") return data.notes || "";
  if (data.type === "credit_card") return data.notes || "";
  return data.notes || data.address || "";
}

function hasActiveQuery(query: ParsedSearchQuery) {
  return (
    query.text.length > 0 ||
    query.fields.length > 0 ||
    query.types.length > 0 ||
    query.favorite !== undefined ||
    query.hasTotp ||
    query.hasCustom
  );
}

function tokenize(input: string) {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[1] || match[2]);
  }

  return tokens;
}

function normalize(value: string) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function isFuzzyMatch(value: string, query: string) {
  if (query.length < 3) return false;

  let queryIndex = 0;
  for (const char of value) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) return true;
    }
  }

  return false;
}
