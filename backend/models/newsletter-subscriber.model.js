import mongoose from "mongoose";

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    isSubscribed: { type: Boolean, default: true, index: true },
    consentedAt: { type: Date, required: true },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

newsletterSubscriberSchema.index({ email: 1 }, { unique: true });

export default mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);
