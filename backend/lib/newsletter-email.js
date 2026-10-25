// Transactional newsletter mail (confirmation and unsubscribe links) using the
// same Resend configuration as password-reset-email.js. When the transport is
// not configured nothing is sent and callers keep the subscription pending.

const siteOrigin = () => process.env.APP_URL || process.env.FRONTEND_URL || "";

export const isNewsletterEmailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && siteOrigin());

const linkFor = (pathname, token) => {
  const url = new URL(pathname, siteOrigin());
  url.searchParams.set("token", token);
  return url.toString();
};

const send = async (email, subject, html) => {
  if (!isNewsletterEmailConfigured()) {
    const error = new Error("Newsletter email is not configured");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject, html }),
  });
  if (!response.ok) throw new Error("Newsletter email provider returned HTTP " + response.status);
};

const wrap = (body) => '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#1c1f24">' +
  '<p style="margin:0 0 16px;font-size:22px;font-weight:800;color:#ea580c">MIBA · میبا</p>' + body +
  '<p style="margin-top:24px;font-size:12px;color:#6b717b">میبا — فروشگاه تخصصی قطعات یدکی خودروهای چینی</p></div>';

export const sendNewsletterConfirmationEmail = (email, token) =>
  send(email, "تأیید عضویت در خبرنامه میبا", wrap(
    "<p>برای فعال‌شدن عضویت در خبرنامه، روی پیوند زیر بزنید و عضویت را تأیید کنید.</p>" +
    '<p><a href="' + linkFor("/api/newsletter/confirm", token) + '">تأیید عضویت</a></p>' +
    "<p>این پیوند ۳ روز اعتبار دارد. اگر این درخواست از طرف شما نبوده است، این ایمیل را نادیده بگیرید؛ بدون تأیید شما هیچ خبرنامه‌ای ارسال نمی‌شود.</p>"
  ));

export const sendNewsletterUnsubscribeEmail = (email, token) =>
  send(email, "لغو عضویت خبرنامه میبا", wrap(
    "<p>برای لغو عضویت در خبرنامه روی پیوند زیر بزنید.</p>" +
    '<p><a href="' + linkFor("/api/newsletter/unsubscribe", token) + '">لغو عضویت</a></p>' +
    "<p>اگر این درخواست از طرف شما نبوده است، این ایمیل را نادیده بگیرید.</p>"
  ));
