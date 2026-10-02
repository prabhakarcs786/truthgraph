import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@sanity/client";
import { z } from "zod";
import { accessMatches, RequestError } from "./http";
import { investigationSchema, type Investigation } from "./knowledge";
import { writer } from "./import-management";
import { commitWithinDocumentBudget } from "./sanity-budget";

const receiptLifetime = 60 * 60 * 1000;
const signingKey = () => process.env.KNOWLEDGE_ADMIN_CODE || process.env.LIVE_ACCESS_CODE || "";
const withoutReceipt = (result: Investigation) => {
  const canonical = investigationSchema.parse(result);
  delete canonical.shareReceipt;
  return canonical;
};
const signatureFor = (result: Investigation, id: string, issuedAt: string, expiresAt: string, secret: string) => createHmac("sha256", secret).update(JSON.stringify({ id, issuedAt, expiresAt, result: withoutReceipt(result) })).digest("hex");

export function offerInvestigationShare(result: Investigation, secret = signingKey(), now = Date.now(), canStore = Boolean(process.env.SANITY_WRITE_TOKEN)): Investigation {
  if (!canStore || result.mode !== "live" || result.knowledgeBase.kind !== "real" || secret.length < 24) return result;
  const id = randomUUID();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + receiptLifetime).toISOString();
  return { ...result, shareReceipt: { id, issuedAt, expiresAt, signature: signatureFor(result, id, issuedAt, expiresAt, secret) } };
}

export function verifyInvestigationShare(input: unknown, secret = signingKey(), now = Date.now()) {
  const result = investigationSchema.parse(input);
  const receipt = result.shareReceipt;
  if (result.mode !== "live" || result.knowledgeBase.kind !== "real" || !receipt || secret.length < 24 || !accessMatches(receipt.signature, signatureFor(result, receipt.id, receipt.issuedAt, receipt.expiresAt, secret))) throw new RequestError(401, "invalid-share-receipt", "Only an unmodified live investigation from this server can be published.");
  if (Date.parse(receipt.expiresAt) <= now) throw new RequestError(410, "share-receipt-expired", "This share offer expired. Run the investigation again before publishing.");
  return { receipt, result: withoutReceipt(result) };
}

export async function saveSharedInvestigation(input: unknown, signal: AbortSignal) {
  const { result, receipt } = verifyInvestigationShare(input);
  const client = writer();
  const documentId = `tg-investigation-${receipt.id}`;
  if (!await client.getDocument(documentId, { signal })) {
    await commitWithinDocumentBudget(client, 1, (transaction) => transaction.create({
      _id: documentId, _type: "tgInvestigation", title: result.question.slice(0, 120), recordedAt: receipt.issuedAt,
      knowledgeBaseId: result.knowledgeBase._id, snapshot: JSON.stringify(result),
    }), signal);
  }
  return { path: `/investigations/${receipt.id}` };
}

export async function getSharedInvestigation(id: string) {
  if (!z.uuid().safeParse(id).success || !process.env.SANITY_STUDIO_PROJECT_ID) return null;
  const client = createClient({ projectId: process.env.SANITY_STUDIO_PROJECT_ID, dataset: process.env.SANITY_STUDIO_DATASET || "production", apiVersion: "2026-09-01", useCdn: false, token: process.env.SANITY_READ_TOKEN, perspective: "published", timeout: 8_000, maxRetries: 0 });
  const document = await client.getDocument<{ _id: string; _type: string; recordedAt: string; snapshot: string }>(`tg-investigation-${id}`);
  if (!document || document._type !== "tgInvestigation") return null;
  return { recordedAt: z.iso.datetime().parse(document.recordedAt), result: investigationSchema.parse(JSON.parse(document.snapshot)) };
}