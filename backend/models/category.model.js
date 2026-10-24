import mongoose from "mongoose";

const localizedSchema = new mongoose.Schema(
  {
    fa: { type: String, required: true, trim: true, maxlength: 120 },
    en: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const attributeOptionSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 80 },
    name: { type: localizedSchema, required: true },
  },
  { _id: false }
);

const categoryAttributeSchema = new mongoose.Schema(
  {
    key: {
      type: String, required: true, trim: true, lowercase: true, maxlength: 64,
      match: /^[a-z][a-z0-9_]*$/,
    },
    name: { type: localizedSchema, required: true },
    type: {
      type: String,
      enum: ["select", "multi-select", "boolean", "number", "text"],
      default: "select",
      required: true,
    },
    options: { type: [attributeOptionSchema], default: [] },
    required: { type: Boolean, default: false },
    filterable: { type: Boolean, default: true },
    searchable: { type: Boolean, default: true },
    inherited: { type: Boolean, default: true },
    unit: { type: localizedSchema, default: undefined },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    name: { type: localizedSchema, required: true },
    slug: {
      type: String, required: true, trim: true, lowercase: true, maxlength: 96,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
    description: {
      fa: { type: String, trim: true, maxlength: 1000, default: "" },
      en: { type: String, trim: true, maxlength: 1000, default: "" },
    },
    image: { type: String, trim: true, maxlength: 3000000, default: "" },
    sortOrder: { type: Number, min: 0, max: 100000, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    showInNavigation: { type: Boolean, default: true },
    attributes: { type: [categoryAttributeSchema], default: [] },
  },
  { timestamps: true }
);

categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ parentId: 1, sortOrder: 1, "name.fa": 1 });
categorySchema.index({ ancestors: 1 });

export default mongoose.model("Category", categorySchema);
