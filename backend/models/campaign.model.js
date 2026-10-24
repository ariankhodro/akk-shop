import mongoose from "mongoose";
import { isSafeInternalHref } from "../lib/internal-href.js";

const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    // Missing slugs remain valid for legacy campaigns; the API falls back to their ID.
    slug: { type: String, trim: true, lowercase: true, maxlength: 140 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    // Keep the legacy storage ceiling during migration; API handlers write validated HTTPS URLs for new uploads.
    image: { type: String, default: "", trim: true, maxlength: 7000000 },
    productIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },
    href: {
      type: String,
      required: true,
      default: "/shop",
      validate: {
        validator: isSafeInternalHref,
        message: "Campaign links must be relative storefront paths",
      },
    },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, min: 0, default: 0 },
    views: { type: Number, min: 0, default: 0 },
    clicks: { type: Number, min: 0, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

campaignSchema.index({ isActive: 1, startsAt: 1, endsAt: 1, sortOrder: 1 });
campaignSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: "string" } } }
);
export default mongoose.model("Campaign", campaignSchema);
