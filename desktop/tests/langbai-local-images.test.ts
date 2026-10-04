import test from "node:test";
import assert from "node:assert/strict";
import { createLocalImageMethods, originalImageBytes } from "../compat/local-images.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError } from "../src/platform/types.ts";
const image = { filePath: "naitools://imports/source.png", fileUrl: "data:image/png;base64,AQID", width: 832, height: 1216 };
const snapshot = { name: "source.png", type: "image/png", lastModified: 123, base64: "AQID" };

test("picker cancellation does not parse an image or change selection", async () => {
 const api = createLocalImageMethods(async <T>() => null as T, async () => { throw Error("must not parse cancellation"); });
 assert.deepEqual(await api.loadImage(), { ok: false });
});

test("full image bytes are inspected with only the metadata actually present", async () => {
 const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
 const call: Invoke = async <T>(command: string, args?: Record<string, unknown>) => { calls.push({ command, args }); return image as T; };
 const metadata = { imported: { positivePrompt: "artist:retained, 1girl", seed: 123 }, characterCaptions: [] };
 const api = createLocalImageMethods(call, async bytes => { assert.deepEqual([...bytes], [1, 2, 3]); return metadata; });
 assert.deepEqual(await api.loadImageFromPath(image.filePath), { ok: true, image, metadata });
 assert.deepEqual(calls, [{ command: "langbai_image_read", args: { reference: image.filePath } }]);
 const noMetadata = createLocalImageMethods(call, async () => undefined);
 assert.deepEqual(await noMetadata.loadImage(), { ok: true, image });
 assert.ok(!("metadata" in await noMetadata.loadImage()));
});

test("metadata hand-off and reads do not load or clear the workbench", async () => {
 const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
 const call: Invoke = async <T>(command: string, args?: Record<string, unknown>) => { calls.push({ command, args }); return snapshot as T; };
 const api = createLocalImageMethods(call);
 assert.deepEqual(await api.readMetadataSnapshotFromPath(image.filePath), { ok: true, snapshot });
 assert.deepEqual(await api.saveMetadataSnapshotFromPath(image.filePath), { ok: true, snapshot });
 assert.deepEqual(await api.saveMetadataSnapshot(snapshot), { ok: true });
 assert.deepEqual(await api.loadMetadataSnapshot(), { ok: true, snapshot });
 assert.deepEqual(calls.map(c => c.command), ["langbai_metadata_read", "langbai_metadata_read", "langbai_metadata_save", "langbai_metadata_load"]);
 assert.deepEqual(calls.slice(0, 2).map(c => c.args), [{ reference: image.filePath, persist: false }, { reference: image.filePath, persist: true }]);
 const missing = createLocalImageMethods(async <T>() => null as T);
 assert.deepEqual(await missing.loadMetadataSnapshot(), { ok: false });
});

test("workbench clear forgets selection without deleting image/history", async () => {
 const calls: string[] = [];
 const api = createLocalImageMethods(async <T>(command: string) => { calls.push(command); return undefined as T; });
 assert.deepEqual(await api.clearWorkbenchImage(), { ok: true });
 assert.deepEqual(calls, ["langbai_workbench_clear"]);
});

test("storage failure does not masquerade as success or retry", async () => {
 let calls = 0;
 const api = createLocalImageMethods(async () => { calls++; throw new DesktopError("storage_unavailable", "无法打开或写入本地数据；请求不会自动重试。", false); });
 await assert.rejects(api.saveMetadataSnapshot(snapshot), (error: unknown) => error instanceof DesktopError && error.code === "storage_unavailable");
 assert.equal(calls, 1);
});

test("image responses are local bounded data URLs, never external resource fetches", () => {
 for (const fileUrl of ["https://example.test/image.png", "file:///private.png", "data:text/plain;base64,AQID", "data:image/png;base64,", "data:image/png;base64,!!invalid!!", "data:image/png;base64," + "A".repeat(Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4)]) {
  assert.throws(() => originalImageBytes({ ...image, fileUrl }), DesktopError);
 }
});
