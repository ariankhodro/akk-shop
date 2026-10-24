import dotenv from "dotenv";
import mongoose from "mongoose";
import Product from "../backend/models/product.model.js";
import { buildNormalizedProductSearchText } from "../backend/lib/persian-search.js";

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI must be configured before running the Persian search backfill.");
  process.exit(1);
}

const batchSize = 250;
let pending = [];
let updated = 0;

try {
  await mongoose.connect(uri);
  const cursor = Product.find({})
    .select("_id name description category sizes colors variants fit")
    .lean()
    .cursor({ batchSize });

  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const result = await Product.bulkWrite(batch, { ordered: false });
    updated += result.modifiedCount || 0;
  };

  for await (const product of cursor) {
    const searchTextNormalized = buildNormalizedProductSearchText(product);
    pending.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { searchTextNormalized } },
      },
    });
    if (pending.length >= batchSize) await flush();
  }
  await flush();
  console.log(`Persian search normalization completed. Updated ${updated} products.`);
} catch (error) {
  console.error("Persian search backfill failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
