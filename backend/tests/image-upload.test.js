import test from "node:test";
import assert from "node:assert/strict";
import {
  ImageUploadError,
  ImageStorageError,
  deleteManagedCloudinaryImage,
  getManagedCloudinaryPublicId,
  resolveImageReference,
  validateImageDataUrl,
} from "../lib/image-upload.js";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCkAAAAAASUVORK5CYII=";

test("validates image signatures and pixel dimensions rather than trusting data URL MIME", () => {
  const image = validateImageDataUrl(tinyPng, 1024);
  assert.equal(image.mime, "image/png");
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.equal(image.format, "png");
});

test("rejects malformed Base64, unsupported formats, MIME spoofing, and oversized content", () => {
  assert.throws(() => validateImageDataUrl("data:image/svg+xml;base64,PHN2Zz4="), ImageUploadError);
  assert.throws(() => validateImageDataUrl("data:image/png;base64,not valid!"), ImageUploadError);
  assert.throws(() => validateImageDataUrl(tinyPng, 8), ImageUploadError);
  assert.throws(() => validateImageDataUrl(tinyPng.replace("image/png", "image/jpeg")), ImageUploadError);
});

test("uploads validated Base64 to durable HTTPS media storage and stores the returned URL", async () => {
  let uploadedValue;
  let uploadedOptions;
  const url = await resolveImageReference(tinyPng, {
    folder: "categories",
    maxBytes: 1024,
    uploader: {
      async upload(value, options) {
        uploadedValue = value;
        uploadedOptions = options;
        return { secure_url: "https://res.cloudinary.com/test/image/upload/category.png" };
      },
    },
  });
  assert.equal(url, "https://res.cloudinary.com/test/image/upload/category.png");
  assert.equal(uploadedValue, tinyPng);
  assert.equal(uploadedOptions.folder, "categories");
  assert.deepEqual(uploadedOptions.allowed_formats, ["jpg", "png", "webp", "gif"]);
});

test("rejects unsafe remote references and does not expose provider errors", async () => {
  await assert.rejects(
    resolveImageReference(tinyPng, {
      folder: "campaigns",
      uploader: { async upload() { throw new Error("provider secret details"); } },
    }),
    (error) => error instanceof ImageStorageError && !error.message.includes("provider secret details")
  );
  for (const value of ["http://example.com/image.png", "//evil.example/image.png", "javascript:alert(1)", "https://user:pass@example.com/image.png"]) {
    await assert.rejects(resolveImageReference(value), ImageUploadError);
  }
});

test("allows existing local image paths and trusted HTTPS references without reuploading", async () => {
  assert.equal(await resolveImageReference("/images/category.webp"), "/images/category.webp");
  assert.equal(await resolveImageReference("https://images.example.ir/campaign.webp"), "https://images.example.ir/campaign.webp");
});


test("managed Cloudinary IDs are derived only from the expected untransformed app folder", () => {
  assert.equal(
    getManagedCloudinaryPublicId("https://res.cloudinary.com/test/image/upload/v123/categories/nested/item.png", { cloudName: "test", folder: "categories" }),
    "categories/nested/item"
  );
  assert.equal(
    getManagedCloudinaryPublicId("https://res.cloudinary.com/test/image/upload/c_fill,w_100/v123/categories/item.png", { cloudName: "test", folder: "categories" }),
    null
  );
  assert.equal(
    getManagedCloudinaryPublicId("https://res.cloudinary.com/test/image/upload/v123/campaigns/item.webp", { cloudName: "test", folder: "categories" }),
    null
  );
  assert.equal(
    getManagedCloudinaryPublicId("https://res.cloudinary.com/test/image/upload/v123/categories/%2E%2E%2Fproducts%2Fvictim.png", { cloudName: "test", folder: "categories" }),
    null
  );
  assert.equal(
    getManagedCloudinaryPublicId("https://res.cloudinary.com/test/image/upload/v123/categories/%2Fproducts%2Fvictim.png", { cloudName: "test", folder: "categories" }),
    null
  );
  assert.equal(getManagedCloudinaryPublicId("https://images.example.ir/categories/item.png", { cloudName: "test", folder: "categories" }), null);
});

test("image cleanup calls Cloudinary only for recognized app-managed assets", async () => {
  const calls = [];
  const uploader = { async destroy(publicId, options) { calls.push({ publicId, options }); return { result: "ok" }; } };
  assert.equal(await deleteManagedCloudinaryImage(
    "https://res.cloudinary.com/test/image/upload/v123/campaigns/item.gif",
    { cloudName: "test", folder: "campaigns", uploader }
  ), true);
  assert.equal(await deleteManagedCloudinaryImage(
    "https://res.cloudinary.com/test/image/upload/v123/categories/item.gif",
    { cloudName: "test", folder: "campaigns", uploader }
  ), false);
  assert.deepEqual(calls, [{
    publicId: "campaigns/item",
    options: { resource_type: "image", invalidate: true },
  }]);
});
