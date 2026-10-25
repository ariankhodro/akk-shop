import mongoose from "mongoose";
import User from "../models/user.model.js";
import { redis } from "../lib/redis.js";
import { recordAuditEvent } from "../lib/audit-log.js";
import { revokeRefreshSession } from "../lib/refresh-token.js";
import { getPasswordPolicyError } from "../lib/password-policy.js";
import { isPlainObject, readEmail, readPassword, readString } from "../lib/input.js";

// Administrator management of pre-created customer accounts. Wholesale
// accounts can only be created here: public signup always creates a retail
// account. These endpoints only ever act on role "customer" accounts, so the
// wholesale.manage permission can never be used to take over an administrator.

const toLatinDigits = (value) => String(value ?? "")
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

const readWholesaleProfile = (input, previous = {}) => {
  const source = isPlainObject(input) ? input : {};
  const errors = {};
  const pick = (key, max) => {
    if (source[key] === undefined) return previous[key] ?? "";
    const value = readString(source[key], { max });
    if (value === null) errors[key] = "مقدار وارد شده معتبر نیست.";
    return value ?? "";
  };
  const companyName = pick("companyName", 120);
  const city = pick("city", 80);
  const notes = pick("notes", 500);
  const contactPhone = source.contactPhone === undefined ? previous.contactPhone ?? "" : toLatinDigits(source.contactPhone).replace(/[\s-]/g, "");
  if (contactPhone && !/^0\d{9,10}$/.test(contactPhone)) errors.contactPhone = "شماره تماس باید با ۰ شروع شود و ۱۰ یا ۱۱ رقم باشد.";
  const taxId = source.taxId === undefined ? previous.taxId ?? "" : toLatinDigits(source.taxId).replace(/\s/g, "");
  if (taxId && !/^\d{10,16}$/.test(taxId)) errors.taxId = "شناسه ملی / کد اقتصادی باید ۱۰ تا ۱۶ رقم باشد.";
  let discountPercent = previous.discountPercent ?? 0;
  if (source.discountPercent !== undefined && source.discountPercent !== "") {
    discountPercent = Number(toLatinDigits(source.discountPercent));
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 50 || Math.round(discountPercent * 100) !== discountPercent * 100) {
      errors.discountPercent = "درصد تخفیف اختصاصی باید بین ۰ تا ۵۰ باشد.";
    }
  }
  return { errors, profile: { companyName, contactPhone, taxId, city, notes, discountPercent } };
};

const customerView = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive !== false,
  accountType: user.accountType || "retail",
  wholesaleProfile: user.wholesaleProfile
    ? {
      companyName: user.wholesaleProfile.companyName || "",
      contactPhone: user.wholesaleProfile.contactPhone || "",
      taxId: user.wholesaleProfile.taxId || "",
      city: user.wholesaleProfile.city || "",
      notes: user.wholesaleProfile.notes || "",
      discountPercent: user.wholesaleProfile.discountPercent || 0,
    }
    : null,
  mustChangePassword: user.mustChangePassword === true,
  createdAt: user.createdAt,
});

const termsSnapshot = (user) => ({
  accountType: user.accountType || "retail",
  isActive: user.isActive !== false,
  discountPercent: user.wholesaleProfile?.discountPercent ?? 0,
  companyName: user.wholesaleProfile?.companyName ?? "",
});

const revokeSessions = async (userId) => {
  try {
    await revokeRefreshSession(redis, userId);
  } catch (error) {
    // tokenVersion was already bumped: stale access and refresh tokens are rejected.
    console.warn("Unable to revoke refresh session after customer change", { name: error?.name || "Error" });
  }
};

export const createCustomerAccount = async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const email = readEmail(body.email);
  const name = readString(body.name, { min: 2, max: 100 });
  const password = readPassword(body.password);
  const accountType = body.accountType === undefined ? "wholesale" : body.accountType;
  const fieldErrors = {};
  if (!email) fieldErrors.email = "ایمیل معتبر وارد کنید.";
  if (!name) fieldErrors.name = "نام باید بین ۲ تا ۱۰۰ نویسه باشد.";
  if (!["retail", "wholesale"].includes(accountType)) fieldErrors.accountType = "نوع حساب معتبر نیست.";
  const passwordError = password === null ? "رمز عبور اولیه را وارد کنید." : getPasswordPolicyError(password);
  if (passwordError) fieldErrors.password = passwordError;
  const { errors: profileErrors, profile } = readWholesaleProfile(body.wholesaleProfile);
  if (accountType === "wholesale") Object.assign(fieldErrors, profileErrors);
  if (accountType === "wholesale" && !profile.companyName) fieldErrors.companyName = "نام فروشگاه یا شرکت همکار الزامی است.";
  if (Object.keys(fieldErrors).length) {
    return res.status(400).json({ message: Object.values(fieldErrors)[0], fieldErrors });
  }
  try {
    const user = await User.create({
      name,
      email,
      password,
      role: "customer",
      accountType,
      wholesaleProfile: accountType === "wholesale" ? { ...profile, createdBy: req.user._id } : undefined,
      mustChangePassword: body.mustChangePassword !== false,
    });
    await recordAuditEvent(req, {
      action: "customer.account_created", targetType: "user", targetId: user._id,
      summary: "Customer account created by administrator",
      metadata: { targetEmail: user.email, after: termsSnapshot(user) },
    });
    return res.status(201).json({ customer: customerView(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "حسابی با این ایمیل وجود دارد." });
    if (error?.name === "ValidationError") return res.status(400).json({ message: "اطلاعات حساب معتبر نیست." });
    console.error("Unable to create customer account", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "ایجاد حساب ناموفق بود." });
  }
};

export const updateWholesaleTerms = async (req, res) => {
  const customerId = req.params.id;
  if (!mongoose.isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
  const body = isPlainObject(req.body) ? req.body : {};
  if (body.accountType !== undefined && !["retail", "wholesale"].includes(body.accountType)) {
    return res.status(400).json({ message: "نوع حساب معتبر نیست." });
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    return res.status(400).json({ message: "وضعیت حساب معتبر نیست." });
  }
  try {
    const target = await User.findOne({ _id: customerId, role: "customer" });
    if (!target) return res.status(404).json({ message: "حساب مشتری پیدا نشد." });
    const before = termsSnapshot(target);
    const nextType = body.accountType ?? target.accountType ?? "retail";
    const { errors, profile } = readWholesaleProfile(body.wholesaleProfile, target.wholesaleProfile?.toObject?.() || target.wholesaleProfile || {});
    if (nextType === "wholesale" && Object.keys(errors).length) {
      return res.status(400).json({ message: Object.values(errors)[0], fieldErrors: errors });
    }
    if (nextType === "wholesale" && !profile.companyName) {
      return res.status(400).json({ message: "نام فروشگاه یا شرکت همکار الزامی است." });
    }
    target.accountType = nextType;
    if (nextType === "wholesale") {
      target.wholesaleProfile = { ...profile, createdBy: target.wholesaleProfile?.createdBy || req.user._id };
    }
    if (body.isActive !== undefined) target.isActive = body.isActive;
    const after = termsSnapshot(target);
    const pricingChanged = before.accountType !== after.accountType || before.discountPercent !== after.discountPercent;
    const deactivated = before.isActive && !after.isActive;
    // A tier change or deactivation must take effect on the very next request.
    if (pricingChanged || deactivated) target.tokenVersion = (Number.isInteger(target.tokenVersion) ? target.tokenVersion : 0) + 1;
    await target.save();
    if (pricingChanged || deactivated) await revokeSessions(target._id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await recordAuditEvent(req, {
        action: "customer.wholesale_updated", targetType: "user", targetId: target._id,
        summary: "Customer account terms updated",
        metadata: { targetEmail: target.email, before, after },
      });
    }
    return res.json({ customer: customerView(target) });
  } catch (error) {
    if (error?.name === "ValidationError") return res.status(400).json({ message: "اطلاعات حساب معتبر نیست." });
    console.error("Unable to update wholesale terms", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "به‌روزرسانی حساب ناموفق بود." });
  }
};

// Issue a temporary password (for pre-created accounts whose holder has no
// access to email recovery). Every session of the account is revoked.
export const setCustomerPassword = async (req, res) => {
  const customerId = req.params.id;
  if (!mongoose.isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
  const body = isPlainObject(req.body) ? req.body : {};
  const password = readPassword(body.password);
  const passwordError = password === null ? "رمز عبور جدید را وارد کنید." : getPasswordPolicyError(password);
  if (passwordError) return res.status(400).json({ message: passwordError, fieldErrors: { password: passwordError } });
  try {
    const target = await User.findOne({ _id: customerId, role: "customer" });
    if (!target) return res.status(404).json({ message: "حساب مشتری پیدا نشد." });
    target.password = password;
    target.mustChangePassword = true;
    target.tokenVersion = (Number.isInteger(target.tokenVersion) ? target.tokenVersion : 0) + 1;
    await target.save();
    await revokeSessions(target._id);
    await recordAuditEvent(req, {
      action: "customer.password_set", targetType: "user", targetId: target._id,
      summary: "Temporary password issued by administrator",
      metadata: { targetEmail: target.email },
    });
    return res.json({ customer: customerView(target) });
  } catch (error) {
    if (error?.name === "ValidationError") return res.status(400).json({ message: "رمز عبور با سیاست امنیتی مطابقت ندارد." });
    console.error("Unable to set customer password", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "تغییر رمز عبور ناموفق بود." });
  }
};
