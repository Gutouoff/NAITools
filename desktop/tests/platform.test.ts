import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeApi, previewApi, type Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError, normalizeError } from "../src/platform/types.ts";
const generation = JSON.parse(readFileSync(new URL("../contracts/generation-v1.fixture.json", import.meta.url), "utf8")).input;
const fixture = JSON.parse(readFileSync(new URL("../contracts/ipc-v1.fixture.json", import.meta.url), "utf8"));

test("browser preview identifies itself and does not fabricate native measurements", async () => {
  const boot = await previewApi().bootstrap();
  assert.equal(boot.runtime, "browser_preview"); assert.equal(boot.storage, "unavailable");
  assert.equal(boot.hostElapsedMs, null); assert.equal(boot.rendererReadyHostMs, null);
  assert.equal(boot.naiContract.generationEnabled, false);
});
test("browser preview refuses persistence/history rather than fake successful responses", async () => {
  const api = previewApi();
  for (const call of [() => api.loadDraft(), () => api.saveDraft(fixture.draft), () => api.listHistory({})]) {
    await assert.rejects(call, (e: unknown) => e instanceof DesktopError && e.code === "native_unavailable");
  }
  await assert.rejects(() => api.submitGeneration(generation), (e: unknown) => e instanceof DesktopError && e.code === "native_unavailable");
});
test("draft mapping drops unknown properties", async () => {
  let received: unknown;
  const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
    assert.equal(command, "draft_save"); received = args; return undefined as T;
  };
  await nativeApi(invoke).saveDraft({ ...fixture.draft, token: "fixture-only-not-a-real-token" });
  assert.deepEqual(received, { draft: fixture.draft });
});
test("history query maps stable cursor and bounded default page", async () => {
  const calls: unknown[] = [];
  const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
    assert.equal(command, "history_list"); calls.push(args); return fixture.emptyHistoryPage as T;
  };
  const api = nativeApi(invoke); await api.listHistory({});
  const before = { createdAtMs: 10, id: "b" }; await api.listHistory({ limit: 2, before });
  assert.deepEqual(calls, [{ query: fixture.historyQuery }, { query: { limit: 2, before } }]);
});
test("native errors do not silently fallback or auto retry", async () => {
  let count = 0;
  const invoke: Invoke = async () => { count++; throw { code: "contract_unverified", message: "not verified", retryable: false }; };
  await assert.rejects(() => nativeApi(invoke).submitGeneration(generation), (e: unknown) => e instanceof DesktopError && e.code === "contract_unverified" && !e.retryable);
  assert.equal(count, 1);
});
test("unknown transport errors redact their body", () => {
  const error = normalizeError("credential or server response body");
  assert.equal(error.code, "ipc_failed"); assert.equal(error.retryable, false);
  assert.ok(!error.message.includes("credential"));
});
test("IPC schema mismatch is rejected before using a newer host", async () => {
  const invoke: Invoke = async <T>() => ({ schemaVersion: 999 }) as T;
  await assert.rejects(() => nativeApi(invoke).bootstrap(), (e: unknown) => e instanceof DesktopError && e.code === "schema_mismatch");
});
