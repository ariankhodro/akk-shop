import mongoose from "mongoose";
import Campaign from "../models/campaign.model.js";
import Product from "../models/product.model.js";
import { recordAuditEvent } from "../lib/audit-log.js";
import { ImageUploadError, ImageStorageError, deleteManagedCloudinaryImage, resolveImageReference } from "../lib/image-upload.js";

const persianSlugCharacters = {
  "آ": "a", "أ": "a", "إ": "e", "ا": "a", "ب": "b", "پ": "p", "ت": "t", "ث": "s",
  "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ذ": "z", "ر": "r", "ز": "z",
  "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z",
  "ع": "a", "غ": "gh", "ف": "f", "ق": "gh", "ک": "k", "ك": "k", "گ": "g",
  "ل": "l", "م": "m", "ن": "n", "و": "v", "ه": "h", "ة": "h", "ی": "y",
  "ي": "y", "ى": "y", "ئ": "y", "ؤ": "v", "ء": "",
};

const createCampaignSlug = (title, id) => {
  const slugTitle = String(title || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[۰-۹٠-٩]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit) >= 0
      ? "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)
      : "٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[آأإابپتثجچحخدذرزژسشصضطظعغفقکكلمنوهةیئىؤء]/g, (character) => persianSlugCharacters[character] ?? character)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return (slugTitle || "campaign") + "-" + String(id);
};

const isValidCampaignInput = (body) => {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const href = typeof body.href === "string" ? body.href.trim() : "";
  const endsAt = new Date(body.endsAt);
  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
  return Boolean(
    title &&
    title.length <= 100 &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    Number.isFinite(startsAt.getTime()) &&
    Number.isFinite(endsAt.getTime()) &&
    endsAt > startsAt &&
    Number.isInteger(Number(body.sortOrder ?? 0)) &&
    Number(body.sortOrder ?? 0) >= 0 &&
    Array.isArray(body.productIds ?? []) &&
    (body.productIds ?? []).length <= 48 &&
    (body.productIds ?? []).every((id) => mongoose.isValidObjectId(id)) &&
    new Set((body.productIds ?? []).map(String)).size === (body.productIds ?? []).length
  );
};

export const getActiveCampaigns = async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 8;
    const now = new Date();
    const campaigns = await Campaign.find({
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    }).sort({ sortOrder: 1, createdAt: -1 }).limit(limit).lean();
    return res.json({ campaigns });
  } catch (error) {
    console.error("Error loading active campaigns", error.message);
    return res.status(500).json({ message: "Unable to load campaigns" });
  }
};

export const getCampaignById = async (req, res) => {
  const key = String(req.params.id || "").trim();
  if (!key || key.length > 140) return res.status(404).json({ message: "Campaign not found" });
  const lookup = mongoose.isValidObjectId(key) ? { _id: key } : { slug: key };
  try {
    const now = new Date();
    const campaign = await Campaign.findOneAndUpdate({
      ...lookup,
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    }, { $inc: { views: 1 } }, { new: true }).select("slug title description image href startsAt endsAt productIds views clicks").populate({
      path: "productIds",
      match: { isActive: { $ne: false } },
      select: "name description price image images category sizes colors variants fit stock isFeatured isActive createdAt",
    }).lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found or no longer active" });
    return res.json({ campaign });
  } catch (error) {
    console.error("Error loading campaign detail", error.message);
    return res.status(500).json({ message: "Unable to load campaign" });
  }
};

export const trackCampaignClick = async (req, res) => {
  const key = String(req.params.id || "").trim();
  if (!key || key.length > 140) return res.status(404).json({ message: "Campaign not found" });
  const lookup = mongoose.isValidObjectId(key) ? { _id: key } : { slug: key };
  try {
    const now = new Date();
    const campaign = await Campaign.findOneAndUpdate({
      ...lookup, isActive: true, startsAt: { $lte: now }, endsAt: { $gt: now },
    }, { $inc: { clicks: 1 } }, { new: false }).select("_id").lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found or no longer active" });
    return res.json({ success: true });
  } catch (error) {
    console.error("Unable to record campaign click", error.message);
    return res.status(500).json({ message: "Unable to record campaign click" });
  }
};

export const getAllCampaigns = async (_req, res) => {
  try {
    const campaigns = await Campaign.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({ campaigns });
  } catch (error) {
    console.error("Error loading campaigns", error.message);
    return res.status(500).json({ message: "Unable to load campaigns" });
  }
};

export const createCampaign = async (req, res) => {
  let pendingUploadedImage = "";
  try {
    if (!isValidCampaignInput(req.body)) {
      return res.status(400).json({ message: "Enter a title, a valid local link, and a future end date" });
    }
    const productIds = (req.body.productIds || []).map(String);
    const validProducts = productIds.length
      ? await Product.find({ _id: { $in: productIds }, isActive: { $ne: false } }).select("_id").lean()
      : [];
    if (validProducts.length !== productIds.length) {
      return res.status(400).json({ message: "One or more selected campaign products are unavailable" });
    }
    const image = await resolveImageReference(req.body.image ?? "", {
      folder: "campaigns",
      maxBytes: 5 * 1024 * 1024,
    });
    if (typeof req.body.image === "string" && req.body.image.startsWith("data:")) pendingUploadedImage = image;
    const campaignId = new mongoose.Types.ObjectId();
    const campaign = await Campaign.create({
      _id: campaignId,
      slug: createCampaignSlug(req.body.title.trim(), campaignId),
      title: req.body.title.trim(),
      description: typeof req.body.description === "string" ? req.body.description.trim().slice(0, 300) : "",
      image,
      href: req.body.href.trim(),
      startsAt: req.body.startsAt ? new Date(req.body.startsAt) : new Date(),
      endsAt: new Date(req.body.endsAt),
      productIds: validProducts.map((product) => product._id),
      isActive: req.body.isActive !== false,
      sortOrder: Number(req.body.sortOrder ?? 0),
      createdBy: req.user._id,
    });
    pendingUploadedImage = "";
    await recordAuditEvent(req, {
      action: "campaign.created",
      targetType: "campaign",
      targetId: campaign._id,
      summary: "Campaign created: " + campaign.title,
      metadata: {
        after: {
          slug: campaign.slug,
          title: campaign.title,
          description: campaign.description,
          image: campaign.image,
          href: campaign.href,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          isActive: campaign.isActive,
          sortOrder: campaign.sortOrder,
          productIds: campaign.productIds.map(String),
        },
        productCount: campaign.productIds.length,
      },
    });
    return res.status(201).json({ campaign });
  } catch (error) {
    if (pendingUploadedImage) {
      await deleteManagedCloudinaryImage(pendingUploadedImage, { folder: "campaigns" }).catch((cleanupError) => {
        console.error("Unpersisted campaign image cleanup failed", { name: cleanupError?.name || "Error" });
      });
    }
    if (error instanceof ImageUploadError) return res.status(400).json({ message: error.message });
    if (error instanceof ImageStorageError) return res.status(502).json({ message: error.message });
    console.error("Error creating campaign", error.message);
    return res.status(500).json({ message: "Unable to create campaign" });
  }
};

export const updateCampaign = async (req, res) => {
  let pendingUploadedImage = "";
  try {
    const current = await Campaign.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Campaign not found" });
    const before = {
      slug: current.slug || String(current._id),
      title: current.title,
      description: current.description,
      image: current.image,
      href: current.href,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      isActive: current.isActive,
      sortOrder: current.sortOrder,
      productIds: (current.productIds || []).map(String),
    };
    const next = { ...current.toObject(), ...req.body };
    if (!isValidCampaignInput(next)) {
      return res.status(400).json({ message: "Campaign fields are invalid" });
    }
    const productIds = (next.productIds || []).map(String);
    const validProducts = productIds.length
      ? await Product.find({ _id: { $in: productIds }, isActive: { $ne: false } }).select("_id").lean()
      : [];
    if (validProducts.length !== productIds.length) {
      return res.status(400).json({ message: "One or more selected campaign products are unavailable" });
    }
    const imageWasProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "image");
    // Older campaign records may contain the previously truncated Base64 string.
    // Preserve it for non-image edits so toggling campaign status still works;
    // a newly selected data URL is validated and stored normally.
    const unchangedLegacyDataUrl = imageWasProvided &&
      typeof next.image === "string" &&
      next.image.startsWith("data:") &&
      next.image === current.image;
    const image = !imageWasProvided || unchangedLegacyDataUrl
      ? (current.image || "")
      : await resolveImageReference(next.image ?? "", {
          folder: "campaigns",
          maxBytes: 5 * 1024 * 1024,
        });
    if (imageWasProvided && !unchangedLegacyDataUrl &&
        typeof next.image === "string" && next.image.startsWith("data:")) pendingUploadedImage = image;
    current.title = next.title.trim();
    current.description = typeof next.description === "string" ? next.description.trim().slice(0, 300) : "";
    current.image = image;
    current.href = next.href.trim();
    current.startsAt = new Date(next.startsAt);
    current.endsAt = new Date(next.endsAt);
    current.productIds = validProducts.map((product) => product._id);
    current.isActive = next.isActive !== false;
    current.sortOrder = Number(next.sortOrder ?? 0);
    await current.save();
    pendingUploadedImage = "";
    if (before.image && before.image !== current.image) {
      await deleteManagedCloudinaryImage(before.image, { folder: "campaigns" }).catch((cleanupError) => {
        console.error("Replaced campaign image cleanup failed", { name: cleanupError?.name || "Error" });
      });
    }
    await recordAuditEvent(req, {
      action: "campaign.updated",
      targetType: "campaign",
      targetId: current._id,
      summary: "Campaign updated: " + current.title,
      metadata: {
        before,
        after: {
          slug: current.slug || String(current._id),
          title: current.title,
          description: current.description,
          image: current.image,
          href: current.href,
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          isActive: current.isActive,
          sortOrder: current.sortOrder,
          productIds: (current.productIds || []).map(String),
        },
        productCount: (current.productIds || []).length,
      },
    });
    return res.json({ campaign: current });
  } catch (error) {
    if (pendingUploadedImage) {
      await deleteManagedCloudinaryImage(pendingUploadedImage, { folder: "campaigns" }).catch((cleanupError) => {
        console.error("Unpersisted campaign image cleanup failed", { name: cleanupError?.name || "Error" });
      });
    }
    if (error instanceof ImageUploadError) return res.status(400).json({ message: error.message });
    if (error instanceof ImageStorageError) return res.status(502).json({ message: error.message });
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid campaign ID" });
    console.error("Error updating campaign", error.message);
    return res.status(500).json({ message: "Unable to update campaign" });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    const deletedSnapshot = {
      slug: campaign.slug || String(campaign._id),
      title: campaign.title,
      description: campaign.description,
      image: campaign.image,
      href: campaign.href,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      isActive: campaign.isActive,
      sortOrder: campaign.sortOrder,
      productIds: (campaign.productIds || []).map(String),
    };
    await Campaign.deleteOne({ _id: campaign._id });
    await deleteManagedCloudinaryImage(campaign.image, { folder: "campaigns" }).catch((cleanupError) => {
      console.error("Deleted campaign image cleanup failed", { name: cleanupError?.name || "Error" });
    });
    await recordAuditEvent(req, {
      action: "campaign.deleted",
      targetType: "campaign",
      targetId: campaign._id,
      summary: "Campaign deleted: " + campaign.title,
      metadata: { before: deletedSnapshot },
    });
    return res.json({ message: "Campaign deleted" });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid campaign ID" });
    console.error("Error deleting campaign", error.message);
    return res.status(500).json({ message: "Unable to delete campaign" });
  }
};
