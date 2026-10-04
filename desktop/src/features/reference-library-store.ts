export type ReferenceKind = "vibe" | "precise";
export type ReferencePreset = {
  id: string;
  kind: ReferenceKind;
  name: string;
  note: string;
  createdAt: number;
  blob: Blob;
};

const DB_NAME = "naitools-reference-library";
const STORE = "presets";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateReferenceFile(file: Pick<Blob, "type" | "size">): void {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("仅支持 PNG、JPEG 或 WebP 图像文件。");
  if (file.size === 0) throw new Error("参考文件为空，无法导入。");
  if (file.size > MAX_FILE_BYTES) throw new Error("参考文件不得超过 16 MB。");
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本地预设库。请检查应用本地存储是否可用。"));
  });
}

// Settle on transaction completion, not request success; an aborted write is never a successful save.
// Every operation closes its database connection, including aborted/failed transactions.
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(new Error("预设库操作未完成。请检查应用本地存储是否可用。")); };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function readReferences(): Promise<ReferencePreset[]> {
  const rows = await transaction<ReferencePreset[]>("readonly", store => store.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveReference(preset: ReferencePreset): Promise<void> {
  await transaction("readwrite", store => store.put(preset));
}

export async function deleteReference(id: string): Promise<void> {
  await transaction("readwrite", store => store.delete(id));
}
