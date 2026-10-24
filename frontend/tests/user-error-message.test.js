import test from "node:test";
import assert from "node:assert/strict";
import { getUserErrorMessage, toPersianUserMessage } from "../src/lib/user-error-message.js";

test("keeps an existing Persian backend message intact", () => {
  assert.equal(toPersianUserMessage("موجودی کافی نیست", 400), "موجودی کافی نیست");
});

test("translates common authentication failures", () => {
  assert.equal(toPersianUserMessage("Invalid credentials", 401), "ایمیل یا رمز عبور درست نیست.");
});

test("uses safe Persian status fallbacks for unknown English errors", () => {
  assert.equal(toPersianUserMessage("Internal Server Error", 500), "در حال حاضر مشکلی در سرویس فروشگاه پیش آمده است. کمی بعد دوباره تلاش کنید.");
  assert.equal(toPersianUserMessage("Something went wrong", 404), "مورد درخواستی پیدا نشد.");
});

test("does not expose raw network error messages to customers", () => {
  assert.equal(getUserErrorMessage({ message: "Network Error" }), "ارتباط با فروشگاه برقرار نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.");
});

test("translates timeout and preserves status-specific server errors", () => {
  assert.equal(toPersianUserMessage("timeout of 10000ms exceeded"), "پاسخ سرور دیر رسید. چند لحظه دیگر دوباره تلاش کنید.");
  assert.match(toPersianUserMessage("Internal Server Error", 503), /سرویس فروشگاه/);
});
