import test from "node:test";
import assert from "node:assert/strict";
import { persianValidationMessage } from "../src/lib/persian-validity.js";

const field = (overrides = {}, validity = {}) => ({
  tagName: "INPUT",
  type: "text",
  title: "",
  validity: { valid: false, customError: false, ...validity },
  ...overrides,
});

test("valid and custom-error fields produce no replacement message", () => {
  assert.equal(persianValidationMessage(field({}, { valid: true })), "");
  assert.equal(persianValidationMessage(field({}, { valueMissing: true, customError: true })), "");
});

test("native validation states map to Persian messages", () => {
  assert.equal(persianValidationMessage(field({}, { valueMissing: true })), "لطفاً این فیلد را پر کنید.");
  assert.match(persianValidationMessage(field({ type: "checkbox" }, { valueMissing: true })), /تأیید/);
  assert.match(persianValidationMessage(field({ tagName: "SELECT", type: "select-one" }, { valueMissing: true })), /انتخاب/);
  assert.match(persianValidationMessage(field({ type: "email" }, { typeMismatch: true })), /ایمیل/);
  assert.equal(
    persianValidationMessage(field({ minLength: 12 }, { tooShort: true })),
    "این فیلد دست‌کم ۱۲ نویسه لازم دارد.",
  );
  assert.equal(persianValidationMessage(field({ title: "قالب ۰۹xxxxxxxxx" }, { patternMismatch: true })), "قالب ۰۹xxxxxxxxx");
  assert.equal(persianValidationMessage(field({ min: "1" }, { rangeUnderflow: true })), "مقدار باید ۱ یا بیشتر باشد.");
});

test("no message contains Latin-only native English wording", () => {
  const states = ["valueMissing", "typeMismatch", "tooShort", "tooLong", "patternMismatch", "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput"];
  for (const state of states) {
    const message = persianValidationMessage(field({ minLength: 3, maxLength: 5, min: "1", max: "9" }, { [state]: true }));
    assert.match(message, /[؀-ۿ]/, state);
  }
});
