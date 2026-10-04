import test from "node:test";
import assert from "node:assert/strict";
import { validateReferenceFile } from "../src/features/reference-library-store.ts";

test("reference library accepts only the three documented image formats", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.doesNotThrow(() => validateReferenceFile({ type, size: 512 }));
  }
  for (const type of ["image/svg+xml", "image/gif", "text/html", "", "application/json"]) {
    assert.throws(() => validateReferenceFile({ type, size: 512 }), /仅支持 PNG/);
  }
});

test("reference library rejects empty/oversized files and accepts the documented size boundary", () => {
  assert.throws(() => validateReferenceFile({ type: "image/png", size: 0 }), /为空/);
  assert.doesNotThrow(() => validateReferenceFile({ type: "image/png", size: 16 * 1024 * 1024 }));
  assert.throws(() => validateReferenceFile({ type: "image/png", size: 16 * 1024 * 1024 + 1 }), /16 MB/);
});
