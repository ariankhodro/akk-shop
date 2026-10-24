// Idempotent migration for the payment/coupon/refund integrity fields. Dry-run by default.
//   MONGO_URI=... node scripts/migrate-payment-integrity.mjs            # report only
//   MONGO_URI=... node scripts/migrate-payment-integrity.mjs --apply    # write changes
//
// What it does:
//  1. coupons without perUserLimit get perUserLimit = 1 (explicit null = unlimited is kept).
//  2. rebuilds per-user coupon usage counters and redemption records from orders that hold
//     a reserved or redeemed coupon (orders are the source of truth, so re-running is safe).
//  3. unsets empty-string orders.zarinpalRefId (the unique partial index ignores them anyway).
//  4. reports (never edits) duplicate non-empty zarinpalRefId values and duplicate active
//     refund/return cases per order: both would make the new unique indexes fail to build.
import mongoose from "mongoose";

const ACTIVE_CASE_STATUSES = ["open", "in_review", "approved"];

export const runMigration = async (db, { apply = false, log = console.log } = {}) => {
  const report = {};
  const coupons = db.collection("coupons");
  const orders = db.collection("orders");
  const usages = db.collection("couponuserusages");
  const redemptions = db.collection("couponredemptions");
  const cases = db.collection("servicecases");

  report.couponsMissingPerUserLimit = await coupons.countDocuments({ perUserLimit: { $exists: false } });
  if (apply && report.couponsMissingPerUserLimit) {
    await coupons.updateMany({ perUserLimit: { $exists: false } }, { $set: { perUserLimit: 1 } });
  }

  const holding = await orders.find({
    couponCode: { $nin: [null, ""] },
    couponReservationStatus: { $in: ["reserved", "redeemed"] },
  }).project({ _id: 1, user: 1, couponCode: 1, couponReservationStatus: 1 }).toArray();
  const couponByCode = new Map();
  for (const code of new Set(holding.map((order) => order.couponCode))) {
    const coupon = await coupons.findOne({ code }, { projection: { _id: 1 } });
    if (coupon) couponByCode.set(code, coupon._id);
  }
  const counts = new Map();
  const redemptionOps = [];
  for (const order of holding) {
    const couponId = couponByCode.get(order.couponCode);
    if (!couponId) continue;
    const key = `${couponId}:${order.user}`;
    counts.set(key, { coupon: couponId, user: order.user, count: (counts.get(key)?.count || 0) + 1 });
    redemptionOps.push({
      updateOne: {
        filter: { order: order._id },
        update: {
          $setOnInsert: {
            coupon: couponId, code: order.couponCode, user: order.user, order: order._id,
            status: order.couponReservationStatus, createdAt: new Date(), updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }
  report.ordersHoldingCoupons = holding.length;
  report.userCounters = counts.size;
  if (apply) {
    if (redemptionOps.length) await redemptions.bulkWrite(redemptionOps, { ordered: false });
    if (counts.size) {
      await usages.bulkWrite([...counts.values()].map(({ coupon, user, count }) => ({
        updateOne: {
          filter: { coupon, user },
          update: { $set: { count }, $setOnInsert: { createdAt: new Date() }, $currentDate: { updatedAt: true } },
          upsert: true,
        },
      })), { ordered: false });
    }
  }

  report.emptyRefIds = await orders.countDocuments({ zarinpalRefId: "" });
  if (apply && report.emptyRefIds) await orders.updateMany({ zarinpalRefId: "" }, { $unset: { zarinpalRefId: "" } });

  report.duplicateRefIds = (await orders.aggregate([
    { $match: { zarinpalRefId: { $type: "string", $gt: "" } } },
    { $group: { _id: "$zarinpalRefId", orders: { $push: "$_id" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray()).map((group) => ({ refId: group._id, orders: group.orders.map(String) }));

  report.duplicateActiveCases = (await cases.aggregate([
    { $match: { type: { $in: ["refund", "return"] }, status: { $in: ACTIVE_CASE_STATUSES }, order: { $ne: null } } },
    { $group: { _id: { order: "$order", type: "$type" }, cases: { $push: "$_id" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray()).map((group) => ({ order: String(group._id.order), type: group._id.type, cases: group.cases.map(String) }));

  log(`${apply ? "APPLIED" : "DRY RUN (pass --apply to write)"}: ${JSON.stringify(report, null, 2)}`);
  if (report.duplicateRefIds.length || report.duplicateActiveCases.length) {
    log("Resolve the duplicates above manually before the unique indexes can build.");
  }
  return report;
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI must point to the database being migrated.");
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    await runMigration(mongoose.connection.db, { apply: process.argv.includes("--apply") });
  } catch (error) {
    console.error("Payment integrity migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}
