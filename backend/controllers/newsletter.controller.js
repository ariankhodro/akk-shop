import NewsletterSubscriber, { effectiveNewsletterStatus } from "../models/newsletter-subscriber.model.js";
import {
  CONFIRMATION_TTL_MS,
  TOKEN_PATTERN,
  createConfirmationToken,
  createUnsubscribeToken,
  hashToken,
  isUnsubscribeSigningConfigured,
  verifyUnsubscribeToken,
} from "../lib/newsletter-tokens.js";
import {
  isNewsletterEmailConfigured,
  sendNewsletterConfirmationEmail,
  sendNewsletterUnsubscribeEmail,
} from "../lib/newsletter-email.js";

// Minimum gap between mails to the same address. Without it anyone could use
// the public form to flood a victim's inbox.
const MAIL_COOLDOWN_MS = 5 * 60 * 1000;

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";

const isValidEmail = (email) =>
  email.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Tokens are accepted from the JSON body (frontend) or the query string
// (links in emails and one-click form posts).
const readToken = (req) => {
  const candidate = typeof req.body?.token === "string" ? req.body.token : req.query?.token;
  return typeof candidate === "string" ? candidate.trim() : "";
};

const messages = {
  subscribeMailed: "اگر نشانی ایمیل معتبر باشد، پیوند تأیید عضویت برایتان ارسال می‌شود. تا زمان تأیید، عضویت فعال نخواهد شد.",
  subscribePending: "درخواست شما ثبت شد، اما عضویت تا تأیید ایمیل فعال نمی‌شود و ارسال ایمیل تأیید هنوز راه‌اندازی نشده است.",
  unsubscribeRequested: "اگر این نشانی در فهرست خبرنامه باشد، پیوند لغو عضویت برایتان ارسال می‌شود.",
  unsubscribeUnavailable: "برای لغو عضویت از پیوند داخل ایمیل خبرنامه استفاده کنید.",
  confirmed: "عضویت شما در خبرنامه تأیید شد.",
  unsubscribed: "عضویت شما در خبرنامه لغو شد.",
  invalidLink: "پیوند نامعتبر است یا منقضی شده است. درخواست جدیدی ثبت کنید.",
};

const page = (title, body) =>
  '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">' +
  "<title>" + title + "</title></head><body>" +
  '<main style="max-width:560px;margin:48px auto;padding:0 16px;font-family:Tahoma,Arial,sans-serif;line-height:1.9">' +
  "<h1>" + title + "</h1>" + body + '<p><a href="/">بازگشت به فروشگاه</a></p></main></body></html>';

const noStore = (res) => {
  res.set("Cache-Control", "no-store");
  // The token lives in the URL; never leak it through Referer.
  res.set("Referrer-Policy", "no-referrer");
};

const wantsHtml = (req) => req.accepts?.(["json", "html"]) === "html";

const respond = (req, res, status, message, title = "خبرنامه") => {
  noStore(res);
  if (wantsHtml(req)) return res.status(status).type("html").send(page(title, "<p>" + message + "</p>"));
  return res.status(status).json({ message });
};

export const subscribeToNewsletter = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "نشانی ایمیل معتبر وارد کنید." });
  }
  if (req.body?.consent !== true) {
    return res.status(400).json({ message: "برای ثبت درخواست، رضایت خود را تأیید کنید." });
  }

  const now = new Date();
  try {
    if (!isNewsletterEmailConfigured()) {
      // Fail safe: record the request as pending, send nothing, and never touch
      // an existing subscribed/unsubscribed record.
      await NewsletterSubscriber.updateOne(
        { email },
        { $setOnInsert: { email, status: "pending", isSubscribed: false, consentedAt: now } },
        { upsert: true }
      );
      return res.status(200).json({ message: messages.subscribePending });
    }

    const token = createConfirmationToken();
    let reserved = null;
    try {
      // Atomic reservation: only one request per cooldown window may trigger a
      // mail, and an already subscribed address is never modified. Opted-out
      // addresses keep their `unsubscribed` status until the link is confirmed.
      reserved = await NewsletterSubscriber.findOneAndUpdate(
        {
          email,
          status: { $ne: "subscribed" },
          $or: [
            { confirmationSentAt: null },
            { confirmationSentAt: { $lte: new Date(now.getTime() - MAIL_COOLDOWN_MS) } },
          ],
        },
        {
          $set: {
            consentedAt: now,
            confirmTokenHash: hashToken(token),
            confirmTokenExpiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
            confirmationSentAt: now,
          },
          $setOnInsert: { email, status: "pending", isSubscribed: false },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      // Duplicate key: the record exists but is subscribed or within the
      // cooldown window. Treat it exactly like a successful request.
      if (error.code !== 11000) throw error;
    }

    if (reserved) {
      try {
        await sendNewsletterConfirmationEmail(email, token);
      } catch (error) {
        console.error("Newsletter confirmation email failed", { name: error?.name || "Error", code: error?.code });
        // Release the cooldown so the visitor can retry.
        await NewsletterSubscriber.updateOne({ _id: reserved._id }, { $set: { confirmationSentAt: null } }).catch(() => {});
      }
    }
    // Same response whether or not the address exists / was mailed.
    return res.status(200).json({ message: messages.subscribeMailed });
  } catch (error) {
    if (error.code === 11000) return res.status(200).json({ message: messages.subscribeMailed });
    console.error("Error saving newsletter subscription", error.message);
    return res.status(500).json({ message: "ثبت درخواست خبرنامه انجام نشد. بعداً دوباره تلاش کنید." });
  }
};

// GET /confirm?token=... renders a confirmation button. The state change only
// happens on POST so mail scanners that prefetch links cannot confirm for the
// owner.
export const showNewsletterConfirmation = (req, res) => {
  const token = readToken(req);
  if (!TOKEN_PATTERN.test(token)) return respond(req, res, 400, messages.invalidLink);
  noStore(res);
  return res.status(200).type("html").send(page(
    "تأیید عضویت در خبرنامه",
    '<form method="post" action="confirm?token=' + token + '"><button type="submit">تأیید عضویت</button></form>'
  ));
};

export const confirmNewsletterSubscription = async (req, res) => {
  const token = readToken(req);
  if (!TOKEN_PATTERN.test(token)) return respond(req, res, 400, messages.invalidLink);
  try {
    const now = new Date();
    const subscriber = await NewsletterSubscriber.findOneAndUpdate(
      { confirmTokenHash: hashToken(token), confirmTokenExpiresAt: { $gt: now } },
      {
        $set: { status: "subscribed", isSubscribed: true, confirmedAt: now, unsubscribedAt: null },
        $unset: { confirmTokenHash: 1, confirmTokenExpiresAt: 1 },
      },
      { new: true }
    );
    if (!subscriber) return respond(req, res, 400, messages.invalidLink);
    return respond(req, res, 200, messages.confirmed, "خبرنامه");
  } catch (error) {
    console.error("Error confirming newsletter subscription", error.message);
    return respond(req, res, 500, "تأیید عضویت انجام نشد. بعداً دوباره تلاش کنید.");
  }
};

export const showNewsletterUnsubscribe = (req, res) => {
  const token = readToken(req);
  if (!verifyUnsubscribeToken(token)) return respond(req, res, 400, messages.invalidLink);
  noStore(res);
  return res.status(200).type("html").send(page(
    "لغو عضویت خبرنامه",
    '<form method="post" action="unsubscribe?token=' + encodeURIComponent(token) + '"><button type="submit">لغو عضویت</button></form>'
  ));
};

// POST with a signed token opts out immediately (one-click, also works for
// List-Unsubscribe-Post). POST with only an email never changes state: it mails
// a signed link to that address, so nobody can unsubscribe someone else.
export const unsubscribeFromNewsletter = async (req, res) => {
  const token = readToken(req);
  if (token) {
    const subscriberId = verifyUnsubscribeToken(token);
    if (!subscriberId) return respond(req, res, 400, messages.invalidLink);
    try {
      await NewsletterSubscriber.updateOne(
        { _id: subscriberId },
        {
          $set: { status: "unsubscribed", isSubscribed: false, unsubscribedAt: new Date() },
          $unset: { confirmTokenHash: 1, confirmTokenExpiresAt: 1 },
        }
      );
      return respond(req, res, 200, messages.unsubscribed, "لغو عضویت");
    } catch (error) {
      console.error("Error saving newsletter opt-out", error.message);
      return respond(req, res, 500, "لغو عضویت انجام نشد. بعداً دوباره تلاش کنید.");
    }
  }

  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "نشانی ایمیل معتبر وارد کنید." });
  }
  try {
    if (isNewsletterEmailConfigured() && isUnsubscribeSigningConfigured()) {
      const now = new Date();
      const subscriber = await NewsletterSubscriber.findOneAndUpdate(
        {
          email,
          status: { $ne: "unsubscribed" },
          $or: [
            { unsubscribeRequestedAt: null },
            { unsubscribeRequestedAt: { $lte: new Date(now.getTime() - MAIL_COOLDOWN_MS) } },
          ],
        },
        { $set: { unsubscribeRequestedAt: now } },
        { new: true }
      );
      if (subscriber) {
        try {
          await sendNewsletterUnsubscribeEmail(email, createUnsubscribeToken(subscriber._id));
        } catch (error) {
          console.error("Newsletter unsubscribe email failed", { name: error?.name || "Error", code: error?.code });
          await NewsletterSubscriber.updateOne({ _id: subscriber._id }, { $set: { unsubscribeRequestedAt: null } }).catch(() => {});
        }
      }
      return res.status(200).json({ message: messages.unsubscribeRequested });
    }
    // No mail transport / signing secret: nothing can have been mailed to this
    // address, and an unauthenticated email must not change anyone's state.
    return res.status(200).json({ message: messages.unsubscribeUnavailable });
  } catch (error) {
    console.error("Error handling newsletter unsubscribe request", error.message);
    return res.status(500).json({ message: "لغو عضویت انجام نشد. بعداً دوباره تلاش کنید." });
  }
};

export const getNewsletterSubscribers = async (_req, res) => {
  try {
    const [subscribers, totals] = await Promise.all([
      NewsletterSubscriber.find({})
        .select("email status isSubscribed consentedAt confirmedAt unsubscribedAt createdAt updatedAt")
        .sort({ updatedAt: -1 })
        .limit(500)
        .lean(),
      NewsletterSubscriber.aggregate([
        { $addFields: { effectiveStatus: { $ifNull: [
          "$status",
          { $cond: [{ $gt: ["$unsubscribedAt", null] }, "unsubscribed", "pending"] },
        ] } } },
        { $group: { _id: "$effectiveStatus", count: { $sum: 1 } } },
      ]),
    ]);
    const counts = Object.fromEntries(totals.map((entry) => [entry._id, entry.count]));
    const summary = {
      total: totals.reduce((sum, entry) => sum + entry.count, 0),
      subscribed: counts.subscribed || 0,
      pending: counts.pending || 0,
      unsubscribed: counts.unsubscribed || 0,
    };
    return res.json({
      // Legacy rows without `status` are never reported as active consent.
      subscribers: subscribers.map((subscriber) => {
        const status = effectiveNewsletterStatus(subscriber);
        return { ...subscriber, status, isSubscribed: status === "subscribed" };
      }),
      summary,
      emailDeliveryConfigured: isNewsletterEmailConfigured(),
    });
  } catch (error) {
    console.error("Error loading newsletter subscribers", error.message);
    return res.status(500).json({ message: "Unable to load newsletter subscribers" });
  }
};
