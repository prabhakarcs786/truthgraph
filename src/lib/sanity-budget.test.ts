import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createIfNotExists: vi.fn(), fetch: vi.fn(), getDocument: vi.fn(), transaction: vi.fn(), patch: vi.fn(), revision: vi.fn(), set: vi.fn(), commit: vi.fn() }));
vi.mock("@sanity/client", () => ({ createClient: () => ({ ...mocks }) }));
import { createClient } from "@sanity/client";
import { commitWithinDocumentBudget, permitPublicInvestigation } from "./sanity-budget";

const client = createClient({ projectId: "test", dataset: "test", apiVersion: "2026-09-01" });
const signal = new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  const patch = { ifRevisionId: mocks.revision, set: mocks.set, commit: mocks.commit };
  mocks.revision.mockReturnValue(patch); mocks.set.mockReturnValue(patch);
  mocks.patch.mockReturnValue(patch);
  const transaction = { patch: vi.fn((_id, modify) => { modify(patch); return transaction; }), commit: mocks.commit };
  mocks.transaction.mockReturnValue(transaction);
  mocks.fetch.mockResolvedValue({ revision: "budget-revision", documents: 147 });
  mocks.getDocument.mockResolvedValue({ _id: "tg-runtime-budget", _rev: "budget-revision", minute: 10, minuteUsed: 0, day: 0, dayUsed: 0 });
  mocks.commit.mockResolvedValue({});
});

describe("shared Sanity budgets", () => {
  it("accepts the exact document boundary and rejects one more", async () => {
    await commitWithinDocumentBudget(client, 3, (transaction) => transaction, signal);
    expect(mocks.revision).toHaveBeenCalledWith("budget-revision");
    await expect(commitWithinDocumentBudget(client, 4, (transaction) => transaction, signal)).rejects.toMatchObject({ status: 409, code: "document-budget" });
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it("rejects a concurrent allocation without committing a partial import", async () => {
    mocks.commit.mockRejectedValue({ statusCode: 409 });
    await expect(commitWithinDocumentBudget(client, 3, (transaction) => transaction, signal)).rejects.toMatchObject({ code: "write-conflict" });
  });
  it("enforces both per-minute and per-day public limits", async () => {
    expect(await permitPublicInvestigation(client, signal, 600_000)).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith({ minute: 10, minuteUsed: 1, day: 0, dayUsed: 1 });
    mocks.getDocument.mockResolvedValue({ _id: "tg-runtime-budget", _rev: "revision", minute: 10, minuteUsed: 12, day: 0, dayUsed: 12 });
    expect(await permitPublicInvestigation(client, signal, 600_000)).toBe(false);
    mocks.getDocument.mockResolvedValue({ _id: "tg-runtime-budget", _rev: "revision", minute: 9, minuteUsed: 1, day: 0, dayUsed: 100 });
    expect(await permitPublicInvestigation(client, signal, 600_000)).toBe(false);
  });
  it("retries revision races but fails closed on missing budget state", async () => {
    mocks.commit.mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({});
    expect(await permitPublicInvestigation(client, signal, 600_000)).toBe(true);
    expect(mocks.getDocument).toHaveBeenCalledTimes(2);
    mocks.getDocument.mockResolvedValue(undefined);
    await expect(permitPublicInvestigation(client, signal)).rejects.toMatchObject({ status: 503 });
  });
});