import { z } from 'zod';
const base64 = (max: number) => z.string().min(1).max(max).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const contactCardSchema = z.object({ version: z.literal(1), id: z.string().uuid(), agreement: base64(88).length(88), signing: base64(88).length(88) }).strict();
export const exchangeContextSchema = z.object({ id: z.string().uuid(), kind: z.enum(['share', 'emergency']), sender: z.string().regex(/^[a-f0-9]{64}$/), recipient: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime(), revision: z.number().int().min(0).max(1000) }).strict();
export const exchangeEnvelopeSchema = z.object({ version: z.literal(1), context: exchangeContextSchema, ephemeral: base64(88).length(88), iv: base64(16).length(16), ciphertext: base64(2_700_000).min(24), signature: base64(88).length(88) }).strict();
export const exchangeKeySchema = z.object({ card: contactCardSchema, wrapped: base64(4096), iv: base64(16).length(16) }).strict();
export const exchangeCreateSchema = z.object({ id: z.string().uuid(), recipient: contactCardSchema, kind: z.enum(['share', 'emergency']), expiresAt: z.string().datetime(), waitHours: z.number().int().min(1).max(720), envelope: exchangeEnvelopeSchema.optional() }).strict();
export const exchangeActionSchema = z.object({ revision: z.number().int().min(0).max(1000), envelope: exchangeEnvelopeSchema.optional() }).strict();
export type ExchangeRecord = { id: string; kind: 'share' | 'emergency'; status: string; revision: number; expiresAt: string; waitHours: number; requestedAt: string | null; senderCard: z.infer<typeof contactCardSchema>; recipientCard: z.infer<typeof contactCardSchema>; envelope?: z.infer<typeof exchangeEnvelopeSchema> | null };
