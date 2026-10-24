const hasPersian = (value) => /[\u0600-\u06FF]/.test(String(value || ""));

const messageRules = [
  [/invalid credentials|incorrect password|wrong password|invalid email or password|authentication failed/i, "ایمیل یا رمز عبور درست نیست."],
  [/email already exists|user already exists|already registered|duplicate.*email/i, "با این ایمیل قبلاً حساب ساخته شده است."],
  [/user not found|account not found|no user found/i, "حسابی با این مشخصات پیدا نشد."],
  [/password.*(weak|short|policy|requirements)|weak password/i, "رمز عبور ضعیف است؛ راهنمای انتخاب رمز را بررسی کنید."],
  [/invalid.*(token|reset link)|expired.*(token|link)|token.*expired/i, "لینک معتبر نیست یا زمان استفاده از آن گذشته است. لینک تازه‌ای درخواست کنید."],
  [/coupon.*(invalid|not found|expired)|invalid coupon/i, "کد تخفیف معتبر نیست یا مهلت استفاده از آن تمام شده است."],
  [/out of stock|insufficient stock|not enough stock/i, "موجودی این محصول برای تعداد درخواستی کافی نیست."],
  [/payment.*(failed|failure)|payment unsuccessful/i, "وضعیت پرداخت هنوز تأیید نشده است. سفارش را دوباره بررسی کنید."],
  [/network error|failed to fetch|network request failed/i, "ارتباط با فروشگاه برقرار نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید."],
  [/timeout|timed out|etimedout/i, "پاسخ سرور دیر رسید. چند لحظه دیگر دوباره تلاش کنید."],
  [/too many requests|rate limit|rate.?limited/i, "درخواست‌های زیادی ارسال شده است. کمی صبر کنید و دوباره تلاش کنید."],
  [/forbidden|access denied|not authorized/i, "اجازه انجام این کار را ندارید."],
  [/not found|does not exist/i, "مورد درخواستی پیدا نشد."],
  [/validation failed|invalid input|bad request/i, "اطلاعات واردشده معتبر نیست. موارد را بررسی کنید."],
];

export function toPersianUserMessage(value, status) {
  if (hasPersian(value)) return String(value).trim();
  const message = String(value || "");
  for (const [pattern, translated] of messageRules) {
    if (pattern.test(message)) return translated;
  }
  if (status === 400 || status === 422) return "اطلاعات واردشده معتبر نیست. موارد را بررسی کنید.";
  if (status === 401) return "برای ادامه، دوباره وارد حساب خود شوید.";
  if (status === 403) return "اجازه انجام این کار را ندارید.";
  if (status === 404) return "مورد درخواستی پیدا نشد.";
  if (status === 409) return "این درخواست با وضعیت فعلی سازگار نیست. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.";
  if (status === 429) return "درخواست‌های زیادی ارسال شده است. کمی صبر کنید و دوباره تلاش کنید.";
  if (status >= 500) return "در حال حاضر مشکلی در سرویس فروشگاه پیش آمده است. کمی بعد دوباره تلاش کنید.";
  return "انجام درخواست ممکن نشد. لطفاً دوباره تلاش کنید.";
}

export function getUserErrorMessage(error, fallback = "انجام درخواست ممکن نشد. لطفاً دوباره تلاش کنید.") {
  if (error?.response?.data?.message) return toPersianUserMessage(error.response.data.message, error.response.status);
  if (error?.userMessage) return error.userMessage;
  if (!error?.response) {
    const translated = toPersianUserMessage(error?.message);
    return translated || fallback;
  }
  return fallback;
}
