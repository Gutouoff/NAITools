import test from "node:test";
import assert from "node:assert/strict";
import { imageFileError, imageDimensionError, MAX_IMAGE_BYTES } from "../src/features/image-import.ts";

test("local image previews accept only bounded, nonempty PNG/JPEG/WebP files", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) assert.equal(imageFileError({type, size: MAX_IMAGE_BYTES}), null);
    assert.ok(imageFileError({type: "image/gif", size: 10}));
    assert.ok(imageFileError({type: "image/png", size: 0}));
    assert.ok(imageFileError({type: "image/png", size: MAX_IMAGE_BYTES + 1}));
});
test("local thumbnail validation respects native image dimension limits", () => {
    assert.equal(imageDimensionError(4096, 4096), null);
    assert.equal(imageDimensionError(8192, 1), null);
    for (const [width, height] of [[0, 1], [1, 8193], [8193, 1], [4096, 4097]]) assert.ok(imageDimensionError(width, height));
});
