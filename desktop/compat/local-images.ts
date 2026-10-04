import type { LoadImageResult, MetadataSnapshotPayload, NaiDesktopApi, WorkingImage } from "../langbai/src/types.ts";
import { DesktopError } from "../src/platform/types.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";

const MAX_IMAGE = 16 * 1024 * 1024;
export const LOCAL_IMAGE_METHODS = [
  "loadImage", "loadImageFromPath", "clearWorkbenchImage", "saveMetadataSnapshot",
  "saveMetadataSnapshotFromPath", "readMetadataSnapshotFromPath", "loadMetadataSnapshot",
] as const;
type MetadataReader = (bytes: Uint8Array<ArrayBuffer>) => Promise<LoadImageResult["metadata"]>;

export function originalImageBytes(image: WorkingImage): Uint8Array<ArrayBuffer> {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(image.fileUrl);
  if (!match || match[1].length > Math.ceil(MAX_IMAGE / 3) * 4) {
    throw new DesktopError("image_response_invalid", "本地图像数据无效；未发送请求。", false);
  }
  let binary: string;
  try { binary = atob(match[1]); } catch {
    throw new DesktopError("image_response_invalid", "本地图像编码无效；未发送请求。", false);
  }
  if (binary.length === 0 || binary.length > MAX_IMAGE) {
    throw new DesktopError("image_response_invalid", "本地图像数据超出安全大小限制。", false);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readOriginalMetadata(bytes: Uint8Array<ArrayBuffer>): Promise<LoadImageResult["metadata"]> {
  // Reuse the original parser and mappings, not a second guessed NovelAI schema.
  // This module is loaded on image selection, not on application startup.
  const { inspectImageMetadata, parseImageMeta } = await import("../langbai/src/png-meta");
  const report = inspectImageMetadata(parseImageMeta(bytes.buffer));
  if (!Object.keys(report.imported).length && !report.characterCaptions.length) return undefined;
  return { imported: report.imported, characterCaptions: report.characterCaptions };
}

// MetadataReader injection isolates bridge tests; production uses the frozen
// original parser exclusively. No mock settings/storage/provider is installed.
export function createLocalImageMethods(call: Invoke, inspect: MetadataReader = readOriginalMetadata) {
  async function loaded(image: WorkingImage | null): Promise<LoadImageResult> {
    if (!image) return { ok: false }; // Native picker cancellation is not an error.
    const metadata = await inspect(originalImageBytes(image));
    return metadata ? { ok: true, image, metadata } : { ok: true, image };
  }
  async function snapshot(reference: string, persist: boolean) {
    const snapshot = await call<MetadataSnapshotPayload>("langbai_metadata_read", { reference, persist });
    return { ok: true, snapshot };
  }
  return {
    loadImage: async () => loaded(await call<WorkingImage | null>("langbai_image_pick")),
    loadImageFromPath: async (filePath: string) => loaded(await call<WorkingImage>("langbai_image_read", { reference: filePath })),
    clearWorkbenchImage: async () => {
      await call<void>("langbai_workbench_clear");
      return { ok: true };
    },
    saveMetadataSnapshot: async (payload: MetadataSnapshotPayload) => {
      await call<void>("langbai_metadata_save", { snapshot: payload });
      return { ok: true };
    },
    saveMetadataSnapshotFromPath: (filePath: string) => snapshot(filePath, true),
    readMetadataSnapshotFromPath: (filePath: string) => snapshot(filePath, false),
    loadMetadataSnapshot: async () => {
      const snapshot = await call<MetadataSnapshotPayload | null>("langbai_metadata_load");
      return snapshot ? { ok: true, snapshot } : { ok: false };
    },
  } satisfies Partial<NaiDesktopApi>;
}
