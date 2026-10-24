import mongoose from "mongoose";
import { buildNormalizedProductSearchText } from "../lib/persian-search.js";

const colorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    hex: { type: String, default: "#d5d0c5", match: /^#[0-9a-fA-F]{6}$/ },
  },
  { _id: false }
);

const variantSchema = new mongoose.Schema(
  {
    size: { type: String, default: "", trim: true, maxlength: 24 },
    color: { type: String, default: "", trim: true, maxlength: 40 },
    stock: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: "Variant stock must be a whole number" },
    },
  },
  { _id: false }
);

const sizeMeasurementSchema = new mongoose.Schema(
  {
    size: { type: String, required: true, trim: true, maxlength: 24 },
    chestCm: { type: Number, min: 0, default: null },
    waistCm: { type: Number, min: 0, default: null },
    hipsCm: { type: Number, min: 0, default: null },
    lengthCm: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const fitSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["true-to-size", "slim", "regular", "relaxed", "oversized", "athletic"],
      default: "regular",
    },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    modelHeight: { type: String, trim: true, maxlength: 40, default: "" },
    modelSize: { type: String, trim: true, maxlength: 24, default: "" },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, maxlength: 5000 },
    price: { type: Number, min: 0, required: true },
    image: { type: String, trim: true, default: "" },
    // Keep image for existing integrations while allowing a proper product gallery.
    images: { type: [String], default: [] },
    category: { type: String, required: true, trim: true, maxlength: 96 },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    attributes: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => ({}) },
    searchTextNormalized: { type: String, default: "", select: false },
    sizes: { type: [String], default: [] },
    colors: { type: [colorSchema], default: [] },
    variants: { type: [variantSchema], default: [] },
    fit: { type: fitSchema, default: () => ({}) },
    sizeChart: { type: [sizeMeasurementSchema], default: [] },
    isFeatured: { type: Boolean, default: false },
    // null preserves legacy catalogue records until opening stock is entered by an admin.
    stock: {
      type: Number,
      min: 0,
      default: null,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: "Stock must be a non-negative whole number",
      },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
productSchema.index({ createdAt: -1 });
productSchema.index({ category: 1, price: 1, createdAt: -1 });
productSchema.index({ isActive: 1, category: 1, createdAt: -1, _id: -1 });
productSchema.index({ isActive: 1, isFeatured: 1, createdAt: -1, _id: -1 });

productSchema.pre("validate", function () {
  this.searchTextNormalized = buildNormalizedProductSearchText({
    name: this.name,
    description: this.description,
    category: this.category,
    sizes: this.sizes,
    colors: this.colors,
    variants: this.variants,
    fit: this.fit,
    attributes: this.attributes,
  });
});

export default mongoose.model("Product", productSchema);
