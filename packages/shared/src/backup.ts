import { z } from "zod";

export const MAX_BACKUP_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_BACKUP_FILE_BYTES = 24 * 1024 * 1024;
const id = z.string().uuid();
const date = z.string().datetime();
const encrypted = {
  encryptedData: z.string().min(1), iv: z.string().min(1),
};
const folder = z.object({ id, name: z.string().min(1).max(100), createdAt: date, updatedAt: date }).strict();
const version = z.object({ id, ...encrypted, folderId: id.nullable(), favorite: z.boolean(),
  reason: z.string().min(1).max(100), createdAt: date }).strict();
const attachment = z.object({ id, encryptedMetadata: z.string().min(1), metadataIv: z.string().min(1),
  encryptedBlob: z.string().min(1), blobIv: z.string().min(1), size: z.number().int().positive().max(25 * 1024 * 1024),
  createdAt: date, updatedAt: date }).strict();
const item = z.object({ id, ...encrypted, folderId: id.nullable(), favorite: z.boolean(), deletedAt: date.nullable(),
  createdAt: date, updatedAt: date, versions: z.array(version).max(10000), attachments: z.array(attachment).max(1000) }).strict();

export const personalSnapshotSchema = z.object({
  folders: z.array(folder).max(10000), items: z.array(item).max(10000),
}).strict().superRefine((snapshot, context) => {
  const seen = new Set<string>();
  const unique = (value: string) => {
    if (seen.has(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate backup identifier" });
    seen.add(value);
  };
  const folders = new Set(snapshot.folders.map(entry => entry.id));
  const reference = (value: string | null) => {
    if (value && !folders.has(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Missing backup folder" });
  };
  snapshot.folders.forEach(entry => unique(entry.id));
  snapshot.items.forEach(entry => {
    unique(entry.id); reference(entry.folderId);
    // History may reference a folder that has already been deleted.
    entry.versions.forEach(history => { unique(history.id); });
    entry.attachments.forEach(file => unique(file.id));
  });
});

export const restoreBackupSchema = z.object({
  backupId: id, snapshot: personalSnapshotSchema,
}).strict();
export type PersonalSnapshot = z.infer<typeof personalSnapshotSchema>;
export type RestoreBackupInput = z.infer<typeof restoreBackupSchema>;
export interface BackupCounts { folders: number; items: number; trash: number; versions: number; attachments: number }
export function countBackup(snapshot: PersonalSnapshot): BackupCounts {
  return { folders: snapshot.folders.length, items: snapshot.items.length,
    trash: snapshot.items.filter(item => item.deletedAt !== null).length,
    versions: snapshot.items.reduce((count, item) => count + item.versions.length, 0),
    attachments: snapshot.items.reduce((count, item) => count + item.attachments.length, 0) };
}
