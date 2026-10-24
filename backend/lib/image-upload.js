import cloudinary from "./cloudinary.js";

const MIME_FORMATS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_IMAGE_WIDTH = 8192;
const MAX_IMAGE_HEIGHT = 8192;
const MAX_IMAGE_PIXELS = 40_000_000;

export class ImageUploadError extends Error {
  constructor(message = "تصویر انتخاب‌شده معتبر نیست.") {
    super(message);
    this.name = "ImageUploadError";
  }
}

export class ImageStorageError extends Error {
  constructor() {
    super("ذخیره تصویر در سرویس رسانه ناموفق بود؛ بعداً دوباره تلاش کنید.");
    this.name = "ImageStorageError";
  }
}

const safeImageReference = (value) => {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\u0000-\u001f]/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const jpegDimensions = (buffer) => {
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (offset + 9 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) break;
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + segmentLength;
  }
  return null;
};

const readDimensions = (buffer, mime) => {
  if (mime === "image/png" && buffer.length >= 24 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === "image/jpeg") return jpegDimensions(buffer);
  if (mime === "image/gif" && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (mime === "image/webp" && buffer.length >= 30) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16),
        height: 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16),
      };
    }
    if (chunk === "VP8 " && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buffer[20] === 0x2f && buffer.length >= 25) {
      const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
      };
    }
  }
  return null;
};

const signatureMatches = (buffer, mime) => {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/gif") return buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6));
  if (mime === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
};

export const validateImageDataUrl = (value, maxBytes = 2 * 1024 * 1024) => {
  if (typeof value !== "string") throw new ImageUploadError();
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new ImageUploadError("فرمت تصویر پشتیبانی نمی‌شود؛ فقط JPG، PNG، WebP یا GIF مجاز است.");

  const [, mime, encoded] = match;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > maxBytes ||
      buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new ImageUploadError("حجم یا محتوای تصویر معتبر نیست.");
  }
  if (!signatureMatches(buffer, mime)) throw new ImageUploadError("محتوای واقعی تصویر با فرمت اعلام‌شده مطابقت ندارد.");

  const dimensions = readDimensions(buffer, mime);
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) ||
      dimensions.width < 1 || dimensions.height < 1 ||
      dimensions.width > MAX_IMAGE_WIDTH || dimensions.height > MAX_IMAGE_HEIGHT ||
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new ImageUploadError("ابعاد تصویر معتبر نیست یا بیش از حد مجاز است.");
  }

  return { buffer, mime, format: MIME_FORMATS[mime], width: dimensions.width, height: dimensions.height };
};

export const getManagedCloudinaryPublicId = (
  value,
  { cloudName = process.env.CLOUDINARY_CLOUD_NAME, folder } = {}
) => {
  if (typeof value !== "string" || !cloudName || !folder) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.username || url.password) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== cloudName || segments[1] !== "image" || segments[2] !== "upload") return null;

    let assetSegments = segments.slice(3);
    if (assetSegments[0] && /^v\d+$/.test(assetSegments[0])) assetSegments = assetSegments.slice(1);
    // Transformed URLs are deliberately ignored: these paths are not guaranteed
    // to map one-to-one to an uploaded source asset.
    if (assetSegments.some((segment) => /^v\d+$/.test(segment))) return null;
    if (!assetSegments.length) return null;
    let decodedSegments;
    try {
      decodedSegments = assetSegments.map((part) => decodeURIComponent(part));
    } catch {
      return null;
    }
    // Decode before checking boundaries: encoded slashes, traversal segments,
    // backslashes, and control characters must never escape the managed folder.
    if (decodedSegments[0] !== folder || decodedSegments.some((part) =>
      !part || part === "." || part === ".." || /[\/\\\u0000-\u001f\u007f]/.test(part)
    )) return null;

    const last = decodedSegments[decodedSegments.length - 1];
    decodedSegments[decodedSegments.length - 1] = last.replace(/\.(?:jpe?g|png|webp|gif)$/i, "");
    const publicId = decodedSegments.join("/");
    return publicId || null;
  } catch {
    return null;
  }
};

export const deleteManagedCloudinaryImage = async (
  value,
  { folder, cloudName = process.env.CLOUDINARY_CLOUD_NAME, uploader = cloudinary.uploader } = {}
) => {
  const publicId = getManagedCloudinaryPublicId(value, { cloudName, folder });
  if (!publicId) return false;
  const result = await uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  return result?.result === "ok" || result?.result === "not found";
};

export const resolveImageReference = async (
  value,
  { folder, maxBytes = 2 * 1024 * 1024, uploader = cloudinary.uploader } = {}
) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ImageUploadError();
  const image = value.trim();
  if (!image) return "";
  if (!image.startsWith("data:")) {
    if (!safeImageReference(image)) throw new ImageUploadError("آدرس تصویر باید مسیر محلی امن یا URL معتبر HTTPS باشد.");
    return image;
  }

  validateImageDataUrl(image, maxBytes);
  try {
    const result = await uploader.upload(image, {
      folder,
      resource_type: "image",
      allowed_formats: ["jpg", "png", "webp", "gif"],
      unique_filename: true,
      overwrite: false,
    });
    if (typeof result?.secure_url !== "string" || !safeImageReference(result.secure_url)) {
      throw new Error("No safe HTTPS asset URL returned");
    }
    return result.secure_url;
  } catch {
    throw new ImageStorageError();
  }
};

const MANAGED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

// Strict resolver for product galleries (SEC-3). Unlike resolveImageReference
// it never accepts local paths or arbitrary third-party HTTPS hosts:
//  - data:image/(jpeg|png|webp|gif) URLs are validated and uploaded;
//  - https URLs must already be app-managed Cloudinary assets in `folder`, or
//    exactly match a value in `existing` (the product's currently stored images);
//  - everything else (http, ftp, s3, gs, file, local paths, SVG, ...) is rejected.
// Returns { urls, uploaded } where `uploaded` lists the assets created by this
// call so the caller can clean them up if persistence fails. Assets uploaded
// earlier in the same call are removed here if a later entry is rejected.
export const resolveManagedImageList = async (
  values,
  {
    folder,
    maxBytes = 5 * 1024 * 1024,
    maxCount = 8,
    existing = [],
    cloudName = process.env.CLOUDINARY_CLOUD_NAME,
    uploader = cloudinary.uploader,
  } = {}
) => {
  if (values === undefined || values === null) return { urls: [], uploaded: [] };
  if (!Array.isArray(values)) throw new ImageUploadError("فرمت تصاویر محصول معتبر نیست.");
  const entries = values.map((value) => {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string") throw new ImageUploadError("فرمت تصاویر محصول معتبر نیست.");
    return value.trim();
  }).filter(Boolean);
  if (entries.length > maxCount) throw new ImageUploadError("حداکثر " + maxCount + " تصویر برای هر محصول مجاز است.");

  const known = new Set((existing || []).filter((value) => typeof value === "string" && value));
  const urls = [];
  const uploaded = [];
  try {
    for (const entry of entries) {
      let resolved;
      if (entry.startsWith("data:")) {
        resolved = await resolveImageReference(entry, { folder, maxBytes, uploader });
        uploaded.push(resolved);
      } else if (known.has(entry)) {
        resolved = entry;
      } else {
        const extension = /\.([a-z0-9]+)$/i.exec(entry.split(/[?#]/)[0])?.[1]?.toLowerCase();
        const managed = /^https:\/\//i.test(entry) && safeImageReference(entry) &&
          (!extension || MANAGED_EXTENSIONS.has(extension)) &&
          getManagedCloudinaryPublicId(entry, { cloudName, folder }) !== null;
        if (!managed) {
          throw new ImageUploadError("آدرس تصویر باید تصویر بارگذاری‌شده همین فروشگاه یا فایل JPG، PNG، WebP یا GIF باشد.");
        }
        resolved = entry;
      }
      if (!urls.includes(resolved)) urls.push(resolved);
    }
  } catch (error) {
    await Promise.all(uploaded.map((url) =>
      deleteManagedCloudinaryImage(url, { folder, cloudName, uploader }).catch(() => false)
    ));
    throw error;
  }
  return { urls, uploaded };
};
