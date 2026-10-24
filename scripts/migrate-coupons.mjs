import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI must be configured before migrating coupons.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI);
  const coupons = mongoose.connection.collection("coupons");
  let indexes = [];
  try {
    indexes = await coupons.indexes();
  } catch (error) {
    if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
  }

  const legacyCoupons = await coupons.updateMany(
    { userId: { $exists: true } },
    { $set: { isActive: false } }
  );

  const legacyUserIndexes = indexes.filter((index) =>
    index.name !== "_id_" && index.unique === true && index.key && Object.hasOwn(index.key, "userId")
  );
  for (const index of legacyUserIndexes) {
    await coupons.dropIndex(index.name);
    console.log("Dropped legacy per-user coupon index: " + index.name);
  }

  console.log("Coupon schema migration completed.");
  console.log("Legacy personal coupons disabled: " + (legacyCoupons.modifiedCount || 0));
  console.log("Removed legacy unique userId indexes: " + legacyUserIndexes.length);
  console.log("New admin-created coupon codes can now be shared across customers.");
} catch (error) {
  console.error("Coupon migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
