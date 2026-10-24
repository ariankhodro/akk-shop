import mongoose from "mongoose";

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI must point to the database being migrated.");
  process.exit(1);
}

const legacySessionField = "stripeSessionId";

const run = async () => {
  await mongoose.connect(uri);
  const orders = mongoose.connection.db.collection("orders");
  const indexes = await orders.indexes();
  const indexesToRemove = indexes.filter((index) => Object.hasOwn(index.key || {}, legacySessionField));

  for (const index of indexesToRemove) {
    const keys = Object.entries(index.key || {});
    const isExpectedIndex = index.name === "stripeSessionId_1" &&
      keys.length === 1 &&
      keys[0][0] === legacySessionField &&
      keys[0][1] === 1;

    if (!isExpectedIndex) {
      throw new Error(`Refusing to change unexpected order index "${index.name}". Inspect db.orders.getIndexes() and handle it manually.`);
    }
  }

  // Remove any obsolete index that could block inserts, then remove the old
  // checkout-session values. No orders or financial amounts are deleted/converted.
  for (const index of indexesToRemove) {
    await orders.dropIndex(index.name);
    console.log(`Removed obsolete order index: ${index.name}`);
  }

  const outdatedPaymentMetadata = await orders.updateMany(
    {
      $or: [
        { paymentProvider: { $ne: "zarinpal" } },
        { currency: { $ne: "IRT" } },
      ],
    },
    {
      $unset: {
        [legacySessionField]: "",
        paymentProvider: "",
        currency: "",
      },
    }
  );

  const staleSessionValues = await orders.updateMany(
    { [legacySessionField]: { $exists: true } },
    { $unset: { [legacySessionField]: "" } }
  );

  console.log(JSON.stringify({
    outdatedPaymentMetadataCleared: outdatedPaymentMetadata.modifiedCount,
    staleSessionValuesCleared: staleSessionValues.modifiedCount,
    note: "Order records and amounts were preserved. Records without explicit IRT/Zarinpal metadata remain excluded from the active store order history; no currency conversion was performed.",
  }, null, 2));
};

try {
  await run();
} catch (error) {
  console.error("Order payment metadata migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
