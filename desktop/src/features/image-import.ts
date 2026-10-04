import type { ImageAsset } from "../platform/types.ts";

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export interface SelectedImage {
    name: string;
    width: number;
    height: number;
    previewUrl: string;
    file?: File;
    asset?: ImageAsset;
    error?: string;
}
export function imageFileError(file: Pick<File, "size" | "type">): string | null {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "只支持 PNG、JPEG、WebP 图片。";
    if (!file.size) return "图像文件为空。";
    if (file.size > MAX_IMAGE_BYTES) return "图像文件不得超过 16 MB。";
    return null;
}
export function imageDimensionError(width: number, height: number): string | null {
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) return "图像边长不得超过 8192 像素，且总像素不得超过 16,777,216。";
    return null;
}
// Small, in-memory thumbnails remain visible even when durable storage fails.
// Originals are retained only for explicit retry; no remote request or storage fallback.
export async function prepareImage(file: File): Promise<SelectedImage> {
    const issue = imageFileError(file);
    if (issue) throw new Error(issue);
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        try { await img.decode(); } catch { throw new Error("图像文件无法解码；此次未导入。"); }
        const dimensions = imageDimensionError(img.naturalWidth, img.naturalHeight);
        if (dimensions) throw new Error(dimensions);
        const ratio = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法创建图像预览。");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return { file, name: file.name, width: img.naturalWidth, height: img.naturalHeight, previewUrl: canvas.toDataURL("image/png") };
    } finally { URL.revokeObjectURL(url); }
}
export async function fileBase64(file: File): Promise<string> {
    const issue = imageFileError(file);
    if (issue) throw new Error(issue);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("图像文件读取失败。"));
        reader.onabort = () => reject(new Error("图像文件读取已取消。"));
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string" || !result.includes(",")) return reject(new Error("图像文件读取失败。"));
            resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.readAsDataURL(file);
    });
}
