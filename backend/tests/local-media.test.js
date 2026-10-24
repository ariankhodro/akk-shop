import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalUploader, getManagedLocalImagePath, ImageUploadError } from "../lib/image-upload.js";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCkAAAAAASUVORK5CYII=";

test("local uploader stores validated images under random names and deletes only managed files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "miba-uploads-"));
  try {
    const uploader = createLocalUploader(root);
    const { secure_url: url } = await uploader.upload(tinyPng, { folder: "products" });
    assert.match(url, /^\/uploads\/products\/[a-f0-9]{32}\.png$/);
    const relative = getManagedLocalImagePath(url, { folder: "products" });
    assert.ok((await readFile(path.join(root, relative))).length > 0);
    assert.equal(getManagedLocalImagePath(url, { folder: "categories" }), null, "folder boundary is enforced");
    for (const hostile of ["/uploads/products/../../etc/passwd", "/uploads/products/x.png", "/uploads/products/" + "a".repeat(32) + ".svg"]) {
      assert.equal(getManagedLocalImagePath(hostile, { folder: "products" }), null, hostile);
    }
    await assert.rejects(uploader.upload("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", { folder: "products" }), ImageUploadError);
    await assert.rejects(uploader.upload(tinyPng, { folder: "../escape" }));
    assert.deepEqual(await uploader.destroy("../../etc/passwd"), { result: "not found" });
    assert.deepEqual(await uploader.destroy(relative), { result: "ok" });
    await assert.rejects(stat(path.join(root, relative)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
