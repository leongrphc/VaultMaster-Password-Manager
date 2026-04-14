import { z } from "zod";

export const registerSchema = z.object({
  email: z
    .string()
    .email("Geçerli bir e-posta adresi girin")
    .max(255),
  authHash: z
    .string()
    .min(1, "Auth hash gerekli"),
  kdfSalt: z
    .string()
    .min(1, "KDF salt gerekli"),
  kdfIterations: z
    .number()
    .int()
    .min(100_000)
    .max(2_000_000)
    .default(600_000),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email("Geçerli bir e-posta adresi girin"),
  authHash: z
    .string()
    .min(1, "Auth hash gerekli"),
  code: z
    .string()
    .length(6, "2FA kodu 6 haneli olmalıdır")
    .optional(),
  recoveryCode: z
    .string()
    .min(6, "Recovery code gecersiz")
    .optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const deviceIdSchema = z.object({
  id: z.string().uuid(),
});

export const updateDeviceSchema = z.object({
  deviceName: z
    .string()
    .trim()
    .min(1, "Cihaz adı gerekli")
    .max(100, "Cihaz adı en fazla 100 karakter olabilir"),
});

export const revokeOtherDevicesSchema = z.object({
  currentDeviceId: z.string().uuid(),
});

export const passwordChangeSchema = z.object({
  currentAuthHash: z.string().min(1),
  newAuthHash: z.string().min(1),
  kdfIterations: z.number().int().min(100_000).max(2_000_000),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      encryptedData: z.string().min(1),
      iv: z.string().min(1),
    })
  ),
});

export const accountDeleteSchema = z.object({
  authHash: z.string().min(1),
  code: z.string().length(6).optional(),
  recoveryCode: z.string().min(6).optional(),
});

export const twoFactorCodeSchema = z.object({
  code: z.string().length(6, "6 haneli doğrulama kodu gerekli").optional(),
  recoveryCode: z.string().min(6).optional(),
});

export const createVaultItemSchema = z.object({
  encryptedData: z.string().min(1),
  iv: z.string().min(1),
  folderId: z.string().uuid().nullable().optional(),
  favorite: z.boolean().optional().default(false),
});

export const updateVaultItemSchema = z.object({
  encryptedData: z.string().min(1).optional(),
  iv: z.string().min(1).optional(),
  folderId: z.string().uuid().nullable().optional(),
  favorite: z.boolean().optional(),
});

export const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(100),
});

export const vaultItemIdSchema = z.object({
  id: z.string().uuid(),
});

export const vaultHistoryRestoreSchema = z.object({
  versionId: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type AccountDeleteInput = z.infer<typeof accountDeleteSchema>;
export type CreateVaultItemInput = z.infer<typeof createVaultItemSchema>;
export type UpdateVaultItemInput = z.infer<typeof updateVaultItemSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type DeviceIdInput = z.infer<typeof deviceIdSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type RevokeOtherDevicesInput = z.infer<typeof revokeOtherDevicesSchema>;
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;
