import mongoose from "mongoose";

// Mongo lease used only when Redis is unavailable. Like the Redis lock it is an
// overlap guard, not a correctness requirement: every reconciliation step is a
// compare-and-set or an idempotent transaction.
const leaseSchema = new mongoose.Schema(
  { _id: { type: String, required: true }, token: String, leaseUntil: Date },
  { versionKey: false, collection: "reconciliation_leases" }
);
const Lease = mongoose.models.ReconciliationLease || mongoose.model("ReconciliationLease", leaseSchema);

export const acquireMongoLease = async (key, token, ttlMs, now = new Date()) => {
  try {
    await Lease.findOneAndUpdate(
      { _id: key, leaseUntil: { $lte: now } },
      { $set: { token, leaseUntil: new Date(now.getTime() + ttlMs) } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    if (error?.code === 11000) return false; // another holder, lease still valid
    throw error;
  }
};

export const releaseMongoLease = async (key, token) => {
  await Lease.updateOne({ _id: key, token }, { $set: { leaseUntil: new Date(0) } });
};
