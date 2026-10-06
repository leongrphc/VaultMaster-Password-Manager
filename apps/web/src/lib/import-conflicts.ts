import { decryptJSON, encryptJSON, importMasterKey } from "@vaultmaster/crypto";
import { importItemDataSchema, legacyImportSchema, type ImportPolicy, type PersonalSnapshot, type RestoreBackupInput, type VaultItemData } from "@vaultmaster/shared";

export interface ImportState {
  state: string;
  folders: PersonalSnapshot["folders"];
  items: Array<Omit<PersonalSnapshot["items"][number], "versions" | "attachments"> & { _count: { versions: number; attachments: number } }>;
}
export interface ImportRow { index: number; kind: "new" | "exact" | "same-login" | "renamed"; target?: string; replaceAllowed: boolean }
// Review contains only encrypted content, opaque identifiers and fixed labels.
export interface ImportReview { body: RestoreBackupInput; rows: ImportRow[]; emptyFolderIds: string[] }
const invalid = () => new Error("İçe aktarma doğrulanamadı. Geçersiz veya desteklenmeyen kayıt; hiçbir değişiklik yapılmadı.");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function normalized(data: VaultItemData, title = true) {
  const fields: Record<string, unknown> = { ...data };
  if (!title) delete fields.title;
  for (const [key, value] of Object.entries(fields)) if (value === "" || value === undefined || (Array.isArray(value) && !value.length)) delete fields[key];
  if (data.tags?.length) fields.tags = [...new Set(data.tags)].sort();
  return canonical(fields);
}
function loginIdentity(data: VaultItemData): string | null {
  if (data.type !== "login" || !data.url || !data.username) return null;
  try {
    const url = new URL(data.url.includes("://") ? data.url : `https://${data.url}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return canonical([url.origin, data.username]);
  } catch { return null; }
}
export async function legacyImportSnapshot(payload: unknown, keyBase64: string, guard: () => void): Promise<PersonalSnapshot> {
  const parsed = legacyImportSchema.safeParse(payload);
  if (!parsed.success) throw invalid();
  const key = await importMasterKey(keyBase64);
  const date = new Date().toISOString();
  const snapshot: PersonalSnapshot = { folders: (parsed.data.folders ?? []).map(folder => ({ ...folder, createdAt: date, updatedAt: date })), items: [] };
  for (const item of parsed.data.items) {
    guard();
    const encrypted = await encryptJSON(item.data, key);
    snapshot.items.push({ id: crypto.randomUUID(), encryptedData: encrypted.ciphertext, iv: encrypted.iv,
      folderId: item.folderId ?? null, favorite: item.favorite ?? false, deletedAt: null,
      createdAt: date, updatedAt: date, versions: [], attachments: [] });
  }
  guard(); return snapshot;
}
export async function reviewImport(body: RestoreBackupInput, current: ImportState, keyBase64: string, guard: () => void, preserveEmptyFolders = false): Promise<ImportReview> {
  const key = await importMasterKey(keyBase64);
  const folderName = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const folderMap: Record<string, string> = {};
  for (const folder of body.snapshot.folders) {
    const matches = current.folders.filter(existing => folderName(existing.name) === folderName(folder.name));
    if (matches.length === 1) folderMap[folder.id] = matches[0]!.id;
  }
  const sourceFolders = new Map(body.snapshot.folders.map(folder => [folder.id, folderMap[folder.id] ?? `source:${folder.id}`]));
  const targetFolders = new Map(current.folders.map(folder => [folder.id, folder.id]));
  type Candidate = { id?: string; exact: string; content: string; login: string | null; active: boolean };
  const candidates: Candidate[] = [];
  const read = async (item: { encryptedData: string; iv: string }) => {
    guard();
    try {
      const data = importItemDataSchema.safeParse(await decryptJSON(item.encryptedData, item.iv, key));
      if (!data.success) throw invalid();
      guard(); return data.data;
    } catch { guard(); throw invalid(); }
  };
  const signature = (data: VaultItemData, item: { folderId: string | null; favorite: boolean; deletedAt: string | null }, folders: Map<string, string>) =>
    canonical([normalized(data), item.folderId ? folders.get(item.folderId) ?? item.folderId : null, item.favorite, !!item.deletedAt]);
  for (const item of current.items) {
    const data = await read(item);
    candidates.push({ id: item.id, exact: signature(data, item, targetFolders), content: normalized(data, false), login: loginIdentity(data), active: !item.deletedAt });
  }
  const rows: ImportRow[] = [];
  for (const [index, item] of body.snapshot.items.entries()) {
    const data = await read(item);
    const exact = signature(data, item, sourceFolders);
    const content = normalized(data, false), login = loginIdentity(data);
    const extras = item.versions.length > 0 || item.attachments.length > 0;
    const exactMatch = !extras && candidates.some(candidate => candidate.exact === exact);
    const matches = candidates.filter(candidate => (login && candidate.login === login) || candidate.content === content || (extras && candidate.exact === exact));
    const target = matches.length === 1 ? matches[0]?.id : undefined;
    const kind = exactMatch ? "exact" : matches.length ? (matches.some(candidate => candidate.content === content) ? "renamed" : "same-login") : "new";
    rows.push({ index, kind, target, replaceAllowed: !!target && matches[0]!.active && !extras && !item.deletedAt });
    candidates.push({ exact, content, login, active: !item.deletedAt });
  }
  guard();
  return { body: { ...body, review: { state: current.state, folderMap, replacements: {}, overwriteApproved: false } }, rows, emptyFolderIds: preserveEmptyFolders ? body.snapshot.folders.filter(folder => !body.snapshot.items.some(item => item.folderId === folder.id)).map(folder => folder.id) : [] };
}
export function resolveImport(review: ImportReview, policies: Record<number, ImportPolicy>, overwriteApproved: boolean): RestoreBackupInput {
  const replacements: Record<string, string> = {};
  const items = review.body.snapshot.items.filter((item, index) => {
    const row = review.rows[index]!;
    const policy = row.kind === "new" ? "keep-both" : row.kind === "exact" ? "skip" : policies[index] ?? "skip";
    if (policy === "replace") {
      if (!overwriteApproved || !row.replaceAllowed || !row.target || Object.values(replacements).includes(row.target)) throw new Error("Üzerine yazmak için açık onay ve tek bir hedef gerekli.");
      replacements[item.id] = row.target;
    }
    return policy !== "skip";
  });
  const usedFolders = new Set(items.flatMap(item => [item.folderId, ...item.versions.map(version => version.folderId)]));
  const folders = review.body.snapshot.folders.filter(folder => usedFolders.has(folder.id) || review.emptyFolderIds.includes(folder.id));
  // Full backups preserve intentionally empty folders as well.
  const preserved = folders;
  const ids = new Set(preserved.map(folder => folder.id));
  return { ...review.body, snapshot: { items, folders: preserved }, review: { ...review.body.review!,
    folderMap: Object.fromEntries(Object.entries(review.body.review!.folderMap).filter(([source]) => ids.has(source))), replacements, overwriteApproved } };
}
