export type VaultItemType = "login" | "secure_note" | "credit_card" | "identity" | "passkey";

export interface VaultItemCustomField {
  id: string;
  label: string;
  value: string;
  concealed?: boolean;
}

export interface VaultItemLoginData {
  type: "login";
  title: string;
  url?: string;
  username: string;
  password: string;
  totpSecret?: string;
  notes?: string;
  tags?: string[];
  customFields?: VaultItemCustomField[];
}

export interface VaultItemNoteData {
  type: "secure_note";
  title: string;
  content: string;
  tags?: string[];
  customFields?: VaultItemCustomField[];
}

export interface VaultItemCreditCardData {
  type: "credit_card";
  title: string;
  cardholderName: string;
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  notes?: string;
  tags?: string[];
  customFields?: VaultItemCustomField[];
}

export interface VaultItemIdentityData {
  type: "identity";
  title: string;
  fullName: string;
  email?: string;
  phone?: string;
  organization?: string;
  address?: string;
  notes?: string;
  tags?: string[];
  customFields?: VaultItemCustomField[];
}

export interface VaultItemPasskeyData {
  type: "passkey";
  title: string;
  rpId: string;
  credentialId: string;
  userHandle: string;
  username?: string;
  publicKey?: string;
  privateKey: string;
  signCount?: number;
  transports?: string[];
  notes?: string;
  tags?: string[];
  customFields?: VaultItemCustomField[];
}

export type VaultItemData =
  | VaultItemLoginData
  | VaultItemNoteData
  | VaultItemCreditCardData
  | VaultItemIdentityData
  | VaultItemPasskeyData;

export interface AttachmentResponse {
  id: string;
  vaultItemId: string;
  userId: string;
  encryptedMetadata: string;
  metadataIv: string;
  encryptedBlob: string;
  blobIv: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebAuthnCredentialResponse {
  id: string;
  credentialId: string;
  deviceType?: string | null;
  backedUp: boolean;
  transports?: unknown;
  name?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface VaultItemResponse {
  id: string;
  userId: string;
  folderId: string | null;
  encryptedData: string;
  iv: string;
  favorite: boolean;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultItemVersionResponse {
  id: string;
  vaultItemId: string;
  encryptedData: string;
  iv: string;
  folderId: string | null;
  favorite: boolean;
  reason: string;
  createdAt: string;
}

export interface FolderResponse {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
}

export interface UserResponse {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface DeviceResponse {
  id: string;
  userId: string;
  deviceName: string;
  deviceType: string;
  createdAt: string;
  lastActive: string;
}

export interface AuditEventResponse {
  id: string;
  userId: string;
  deviceId: string | null;
  deviceName?: string | null;
  deviceType?: string | null;
  action: string;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SharedVaultResponse {
  id: string;
  ownerId: string;
  encryptedMetadata: string;
  metadataIv: string;
  currentUserMembership?: SharedVaultMemberResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharedVaultMemberResponse {
  id: string;
  sharedVaultId: string;
  userId: string;
  email?: string;
  role: string;
  encryptedVaultKey: string;
  encryptedVaultKeyIv: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedVaultItemResponse {
  id: string;
  sharedVaultId: string;
  createdById: string;
  encryptedData: string;
  iv: string;
  favorite: boolean;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmergencyAccessStatus =
  | "pending"
  | "active"
  | "requested"
  | "approved"
  | "rejected"
  | "cancelled";

export interface EmergencyAccessGrantResponse {
  id: string;
  ownerId: string;
  ownerEmail?: string;
  contactId: string;
  contactEmail?: string;
  encryptedAccessKey?: string;
  encryptedAccessIv?: string;
  waitTimeDays: number;
  status: EmergencyAccessStatus;
  requestedAt?: string | null;
  availableAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  session?: boolean;
  vaultKeyEnvelope?: VaultKeyEnvelope | null;
  requires2FA?: boolean;
  webAuthnOptions?: unknown;
  user?: UserResponse;
  tokens?: AuthTokens;
  deviceId?: string;
  recoveryCodes?: string[];
  kdfSalt?: string;
  kdfIterations?: number;
}

export interface VaultKeyEnvelope {
  ciphertext: string;
  iv: string;
  version: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
