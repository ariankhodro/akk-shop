import mongoose from "mongoose";

// Double opt-in lifecycle (SEC-6):
//   pending      - address submitted, ownership not yet proven. Never mailed.
//   subscribed   - owner followed the emailed confirmation link.
//   unsubscribed - owner (or a signed unsubscribe link) opted out. Only a new
//                  confirmed double opt-in can reverse this.
// `isSubscribed` is kept for existing admin tooling and is true only for
// `subscribed`. Documents written before this change have no `status`; code
// derives it with effectiveNewsletterStatus() and never treats them as consent.
export const NEWSLETTER_STATUSES = ["pending", "subscribed", "unsubscribed"];

export const effectiveNewsletterStatus = (subscriber) => {
  if (NEWSLETTER_STATUSES.includes(subscriber?.status)) return subscriber.status;
  return subscriber?.unsubscribedAt ? "unsubscribed" : "pending";
};

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    status: { type: String, enum: NEWSLETTER_STATUSES, default: "pending" },
    isSubscribed: { type: Boolean, default: false, index: true },
    consentedAt: { type: Date, required: true },
    confirmedAt: { type: Date, default: null },
    unsubscribedAt: { type: Date, default: null },
    // Only the SHA-256 of the emailed confirmation token is stored.
    confirmTokenHash: { type: String, select: false },
    confirmTokenExpiresAt: { type: Date, select: false },
    confirmationSentAt: { type: Date, select: false },
    unsubscribeRequestedAt: { type: Date, select: false },
  },
  { timestamps: true }
);

newsletterSubscriberSchema.index({ email: 1 }, { unique: true });
newsletterSubscriberSchema.index({ confirmTokenHash: 1 }, { sparse: true });

export default mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);
