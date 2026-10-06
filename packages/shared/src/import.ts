import { z } from "zod";

// Decrypted content is validated only in the unlocked client. Never send these
// schemas' values or validation issues to telemetry or the import API.
const text = z.string().max(1024 * 1024);
const common = { title: text.min(1), tags: z.array(text).max(1000).optional(),
  customFields: z.array(z.object({ id: text, label: text, value: text, concealed: z.boolean().optional() }).strict()).max(1000).optional() };
export const importItemDataSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("login"), url: text.optional(), username: text, password: text, totpSecret: text.optional(), notes: text.optional() }).strict(),
  z.object({ ...common, type: z.literal("secure_note"), content: text }).strict(),
  z.object({ ...common, type: z.literal("credit_card"), cardholderName: text, cardNumber: text, expMonth: text, expYear: text, cvv: text, notes: text.optional() }).strict(),
  z.object({ ...common, type: z.literal("identity"), fullName: text, email: text.optional(), phone: text.optional(), organization: text.optional(), address: text.optional(), notes: text.optional() }).strict(),
  z.object({ ...common, type: z.literal("passkey"), rpId: text, credentialId: text, userHandle: text, username: text.optional(), publicKey: text.optional(), privateKey: text, signCount: z.number().int().nonnegative().optional(), transports: z.array(text).optional(), notes: text.optional() }).strict(),
]);
export const legacyImportSchema = z.object({
  version: z.enum(["1.0", "2.0"]).optional(), exportDate: z.string().datetime().optional(),
  itemCount: z.number().int().nonnegative().optional(), folderCount: z.number().int().nonnegative().optional(),
  folders: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(100) }).strict()).max(10000).optional(),
  items: z.array(z.object({ data: importItemDataSchema, folderId: z.string().uuid().nullable().optional(), favorite: z.boolean().optional(), createdAt: z.string().datetime().optional(), updatedAt: z.string().datetime().optional() }).strict()).max(10000),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.folders?.map(folder => folder.id));
  if (ids.size !== (value.folders?.length ?? 0) || value.items.some(item => item.folderId && !ids.has(item.folderId))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid import references" });
  }
});
export type ImportPolicy = "skip" | "keep-both" | "replace";
