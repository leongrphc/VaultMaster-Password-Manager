import type { VaultItem } from "@prisma/client";
import { prisma } from "../config/prisma.js";

export async function snapshotVaultItem(
  item: Pick<VaultItem, "id" | "encryptedData" | "iv" | "folderId" | "favorite">,
  reason: string
) {
  await prisma.vaultItemVersion.create({
    data: {
      vaultItemId: item.id,
      encryptedData: item.encryptedData,
      iv: item.iv,
      folderId: item.folderId,
      favorite: item.favorite,
      reason,
    },
  });
}
