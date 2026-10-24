import mongoose from "mongoose";

const storeSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    flatRate: { type: Number, min: 0, default: 0 },
    freeShippingThreshold: { type: Number, min: 0, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("StoreSettings", storeSettingsSchema);
