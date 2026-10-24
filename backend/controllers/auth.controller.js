import { redis } from "../lib/redis.js";
import { getPasswordPolicyError } from "../lib/password-policy.js";
import User from "../models/user.model.js";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { isPasswordResetEmailConfigured, sendPasswordResetEmail } from "../lib/password-reset-email.js";
import {
  rotateRefreshToken as rotateStoredRefreshToken,
  verifyPresentedRefreshToken,
  isRefreshAccountActive,
} from "../lib/refresh-token.js";

const generateTokens = (userId) => {
	const accessToken = jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, {
		expiresIn: "15m",
	});

	const refreshToken = jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, {
		expiresIn: "7d",
	});

	return { accessToken, refreshToken };
};

const storeRefreshToken = async (userId, refreshToken) => {
	await redis.set(`refresh_token:${userId}`, refreshToken, "EX", 7 * 24 * 60 * 60); // 7days
};

const setCookies = (res, accessToken, refreshToken) => {
	res.cookie("accessToken", accessToken, {
		httpOnly: true, // prevent XSS attacks, cross site scripting attack
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict", // prevents CSRF attack, cross-site request forgery attack
		maxAge: 15 * 60 * 1000, // 15 minutes
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true, // prevent XSS attacks, cross site scripting attack
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict", // prevents CSRF attack, cross-site request forgery attack
		maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
	});
};

export const signup = async (req, res) => {
	const { email, password, name } = req.body;
	const passwordError = getPasswordPolicyError(password);
	if (passwordError) return res.status(400).json({ message: passwordError, fieldErrors: { password: passwordError } });
	try {
		const userExists = await User.findOne({ email });

		if (userExists) {
			return res.status(400).json({ message: "User already exists" });
		}
		const user = await User.create({ name, email, password });

		// authenticate
		const { accessToken, refreshToken } = generateTokens(user._id);
		await storeRefreshToken(user._id, refreshToken);

		setCookies(res, accessToken, refreshToken);

		res.status(201).json({
			_id: user._id,
			name: user.name,
			email: user.email,
			role: user.role,
      defaultShippingAddress: user.defaultShippingAddress,
		});
	} catch (error) {
		console.error("Signup failed", { name: error?.name, message: error?.message });
		return res.status(500).json({ message: "Unable to create account" });
	}
};

export const login = async (req, res) => {
	try {
		const { email, password } = req.body;
		const user = await User.findOne({ email });

		if (user && (await user.comparePassword(password))) {
      if (!isRefreshAccountActive(user)) {
        return res.status(403).json({ message: "This account is inactive. Contact support." });
      }

			const { accessToken, refreshToken } = generateTokens(user._id);
			await storeRefreshToken(user._id, refreshToken);
			setCookies(res, accessToken, refreshToken);

			res.json({
				_id: user._id,
				name: user.name,
				email: user.email,
				role: user.role,
			});
		} else {
			res.status(400).json({ message: "Invalid email or password" });
		}
	} catch (error) {
		console.error("Login failed", { name: error?.name, message: error?.message });
		return res.status(500).json({ message: "Unable to sign in" });
	}
};

const genericRecoveryMessage = "اگر این ایمیل در فروشگاه ثبت شده باشد، راهنمای بازیابی رمز عبور ارسال می‌شود.";

const normalizeAddressDigits = value => String(value ?? "")
 .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
 .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
const normalizeAddressPhone = value => {
 let phone = normalizeAddressDigits(value).replace(/\D/g, "");
 if (phone.startsWith("0098") && phone.length === 14) phone = "0" + phone.slice(4);
 else if (phone.startsWith("98") && phone.length === 12) phone = "0" + phone.slice(2);
 else if (phone.length === 10 && phone.startsWith("9")) phone = "0" + phone;
 return phone;
};

const normalizeShippingAddress = input => ({
 recipientName: typeof input?.recipientName === "string" ? input.recipientName.trim() : "",
 phone: normalizeAddressPhone(input?.phone),
 province: typeof input?.province === "string" ? input.province.trim() : "",
 city: typeof input?.city === "string" ? input.city.trim() : "",
 district: typeof input?.district === "string" ? input.district.trim() : "",
 addressLine: typeof input?.addressLine === "string" ? input.addressLine.trim() : "",
 postalCode: normalizeAddressDigits(input?.postalCode).replace(/\D/g, ""),
 notes: typeof input?.notes === "string" ? input.notes.trim() : "",
});

const validateShippingAddress = address => {
 const errors = {};
 if (address.recipientName.length < 2 || address.recipientName.length > 100) errors.recipientName = "نام گیرنده باید بین ۲ تا ۱۰۰ نویسه باشد.";
 if (!/^09\d{9}$/.test(address.phone)) errors.phone = "شماره موبایل باید با 09 شروع شود و ۱۱ رقم داشته باشد.";
 if (!address.province || address.province.length > 80) errors.province = "استان را انتخاب کنید.";
 if (address.city.length < 2 || address.city.length > 80) errors.city = "نام شهر را کامل وارد کنید.";
 if (address.district.length > 80) errors.district = "نام محله بیش از حد طولانی است.";
 if (address.addressLine.length < 10 || address.addressLine.length > 500) errors.addressLine = "نشانی باید بین ۱۰ تا ۵۰۰ نویسه باشد.";
 if (!/^\d{10}$/.test(address.postalCode)) errors.postalCode = "کد پستی باید ۱۰ رقم داشته باشد.";
 if (address.notes.length > 500) errors.notes = "توضیحات بیش از حد طولانی است.";
 return errors;
};

const shippingAddressValues = address => ({
 recipientName: address.recipientName,
 phone: address.phone,
 province: address.province,
 city: address.city,
 district: address.district || "",
 addressLine: address.addressLine,
 postalCode: address.postalCode,
 notes: address.notes || "",
});

const addressBookResponse = user => ({
 savedShippingAddresses: user.savedShippingAddresses || [],
 defaultShippingAddress: user.defaultShippingAddress || undefined,
});

const makeDefaultAddress = (user, chosen) => {
 user.savedShippingAddresses.forEach(address => {
  address.isDefault = String(address._id) === String(chosen._id);
 });
 user.defaultShippingAddress = shippingAddressValues(chosen);
};

const ensureAddressBook = user => {
 let changed = false;
 if (!Array.isArray(user.savedShippingAddresses)) user.savedShippingAddresses = [];
 // Migrate the old single-address field the first time the profile is loaded.
 if (user.savedShippingAddresses.length === 0 && user.defaultShippingAddress?.addressLine) {
  user.savedShippingAddresses.push({
   ...shippingAddressValues(user.defaultShippingAddress),
   label: "نشانی پیش‌فرض",
   isDefault: true,
  });
  changed = true;
 }
 if (user.savedShippingAddresses.length > 0) {
  let chosen = user.savedShippingAddresses.find(address => address.isDefault);
  if (!chosen) {
   chosen = user.savedShippingAddresses[0];
   chosen.isDefault = true;
   changed = true;
  }
  user.savedShippingAddresses.forEach(address => {
   const shouldBeDefault = String(address._id) === String(chosen._id);
   if (Boolean(address.isDefault) !== shouldBeDefault) {
    address.isDefault = shouldBeDefault;
    changed = true;
   }
  });
  const nextDefault = shippingAddressValues(chosen);
  const currentDefault = user.defaultShippingAddress?.toObject?.() || user.defaultShippingAddress || null;
  if (JSON.stringify(currentDefault) !== JSON.stringify(nextDefault)) {
   user.defaultShippingAddress = nextDefault;
   changed = true;
  }
 }
 return changed;
};

const validAddressLabel = value => {
 if (value === undefined) return "نشانی من";
 if (typeof value !== "string") return null;
 const label = value.trim();
 return label.length >= 2 && label.length <= 60 ? label : null;
};

export const updateProfile = async (req, res) => {
 const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
 if (name.length < 2 || name.length > 100) {
  return res.status(400).json({ message: "نام باید بین ۲ تا ۱۰۰ نویسه باشد.", fieldErrors: { name: "نام باید بین ۲ تا ۱۰۰ نویسه باشد." } });
 }
 try {
  const user = await User.findById(req.user._id).select("-password");
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  user.name = name;
  await user.save();
  return res.json({ user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
 } catch (error) {
  console.error("Updating customer profile failed", error.message);
  return res.status(500).json({ message: "ذخیره اطلاعات پروفایل ناموفق بود." });
 }
};

export const saveDefaultAddress = async (req, res) => {
 const input = req.body?.shippingAddress;
 if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ message: "اطلاعات نشانی معتبر نیست." });
 const address = normalizeShippingAddress(input);
 const errors = validateShippingAddress(address);
 if (Object.keys(errors).length) return res.status(400).json({ message: "اطلاعات نشانی را بررسی کنید.", fieldErrors: errors });
 try {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  ensureAddressBook(user);
  let target = user.savedShippingAddresses.find(saved =>
   Object.entries(address).every(([key, value]) => (saved[key] || "") === (value || ""))
  );
  if (!target) {
   target = user.savedShippingAddresses.find(saved => saved.isDefault);
   if (target) Object.assign(target, address);
   else {
    if (user.savedShippingAddresses.length >= 10) return res.status(400).json({ message: "حداکثر ۱۰ نشانی می‌توانید ذخیره کنید." });
    user.savedShippingAddresses.push({ ...address, label: "نشانی من", isDefault: false });
    target = user.savedShippingAddresses[user.savedShippingAddresses.length - 1];
   }
  }
  makeDefaultAddress(user, target);
  await user.save();
  return res.json(addressBookResponse(user));
 } catch (error) {
  console.error("Saving default delivery address failed", error.message);
  return res.status(500).json({ message: "ذخیره نشانی پیش‌فرض ناموفق بود." });
 }
};

export const createShippingAddress = async (req, res) => {
 const input = req.body?.shippingAddress || req.body;
 if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ message: "اطلاعات نشانی معتبر نیست." });
 const address = normalizeShippingAddress(input);
 const errors = validateShippingAddress(address);
 const label = validAddressLabel(req.body?.label);
 if (!label) errors.label = "عنوان نشانی باید بین ۲ تا ۶۰ نویسه باشد.";
 if (Object.keys(errors).length) return res.status(400).json({ message: "اطلاعات نشانی را بررسی کنید.", fieldErrors: errors });
 try {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  ensureAddressBook(user);
  if (user.savedShippingAddresses.length >= 10) return res.status(400).json({ message: "حداکثر ۱۰ نشانی می‌توانید ذخیره کنید." });
  const isDefault = req.body?.isDefault === true || user.savedShippingAddresses.length === 0;
  user.savedShippingAddresses.push({ ...address, label, isDefault: false });
  const created = user.savedShippingAddresses[user.savedShippingAddresses.length - 1];
  if (isDefault) makeDefaultAddress(user, created);
  await user.save();
  return res.status(201).json(addressBookResponse(user));
 } catch (error) {
  console.error("Creating saved delivery address failed", error.message);
  return res.status(500).json({ message: "ذخیره نشانی ناموفق بود." });
 }
};

export const updateShippingAddress = async (req, res) => {
 const addressId = req.params.addressId;
 if (!mongoose.isValidObjectId(addressId)) return res.status(400).json({ message: "شناسه نشانی معتبر نیست." });
 const input = req.body?.shippingAddress || req.body;
 if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ message: "اطلاعات نشانی معتبر نیست." });
 const address = normalizeShippingAddress(input);
 const errors = validateShippingAddress(address);
 const label = req.body?.label === undefined ? undefined : validAddressLabel(req.body.label);
 if (req.body?.label !== undefined && !label) errors.label = "عنوان نشانی باید بین ۲ تا ۶۰ نویسه باشد.";
 if (Object.keys(errors).length) return res.status(400).json({ message: "اطلاعات نشانی را بررسی کنید.", fieldErrors: errors });
 try {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  ensureAddressBook(user);
  const saved = user.savedShippingAddresses.id(addressId);
  if (!saved) return res.status(404).json({ message: "نشانی پیدا نشد." });
  Object.assign(saved, address);
  if (label) saved.label = label;
  if (saved.isDefault || req.body?.isDefault === true) makeDefaultAddress(user, saved);
  await user.save();
  return res.json(addressBookResponse(user));
 } catch (error) {
  console.error("Updating saved delivery address failed", error.message);
  return res.status(500).json({ message: "ویرایش نشانی ناموفق بود." });
 }
};

export const setDefaultShippingAddress = async (req, res) => {
 const addressId = req.params.addressId;
 if (!mongoose.isValidObjectId(addressId)) return res.status(400).json({ message: "شناسه نشانی معتبر نیست." });
 try {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  ensureAddressBook(user);
  const saved = user.savedShippingAddresses.id(addressId);
  if (!saved) return res.status(404).json({ message: "نشانی پیدا نشد." });
  makeDefaultAddress(user, saved);
  await user.save();
  return res.json(addressBookResponse(user));
 } catch (error) {
  console.error("Changing default delivery address failed", error.message);
  return res.status(500).json({ message: "تغییر نشانی پیش‌فرض ناموفق بود." });
 }
};

export const deleteShippingAddress = async (req, res) => {
 const addressId = req.params.addressId;
 if (!mongoose.isValidObjectId(addressId)) return res.status(400).json({ message: "شناسه نشانی معتبر نیست." });
 try {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  ensureAddressBook(user);
  const index = user.savedShippingAddresses.findIndex(address => String(address._id) === String(addressId));
  if (index < 0) return res.status(404).json({ message: "نشانی پیدا نشد." });
  const wasDefault = Boolean(user.savedShippingAddresses[index].isDefault);
  user.savedShippingAddresses.splice(index, 1);
  if (wasDefault) {
   if (user.savedShippingAddresses.length) makeDefaultAddress(user, user.savedShippingAddresses[0]);
   else user.defaultShippingAddress = undefined;
  } else if (!user.savedShippingAddresses.length) {
   user.defaultShippingAddress = undefined;
  }
  await user.save();
  return res.json(addressBookResponse(user));
 } catch (error) {
  console.error("Deleting saved delivery address failed", error.message);
  return res.status(500).json({ message: "حذف نشانی ناموفق بود." });
 }
};

export const forgotPassword = async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "ایمیل معتبر وارد کنید." });
  }
  if (!isPasswordResetEmailConfigured()) {
    return res.status(503).json({ message: "بازیابی رمز عبور هنوز در این محیط پیکربندی نشده است." });
  }
  try {
    const user = await User.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      user.passwordResetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
      user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();
      try {
        await sendPasswordResetEmail(email, token);
      } catch (mailError) {
        // Never let a provider failure reveal whether an account exists. Remove the
        // unused token and log provider failure for the operator to investigate.
        user.passwordResetTokenHash = undefined;
        user.passwordResetExpiresAt = undefined;
        await user.save();
        console.error("Unable to send password recovery email", mailError.message);
      }
    }
    return res.json({ message: genericRecoveryMessage });
  } catch (error) {
    console.error("Password recovery request failed", error.message);
    return res.status(500).json({ message: "درخواست بازیابی رمز عبور انجام نشد." });
  }
};

export const resetPassword = async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ message: "لینک بازیابی نامعتبر یا منقضی شده است." });
  const passwordError = getPasswordPolicyError(password);
  if (passwordError) return res.status(400).json({ message: passwordError, fieldErrors: { password: passwordError } });
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    }).select("+passwordResetTokenHash +passwordResetExpiresAt");
    if (!user) return res.status(400).json({ message: "لینک بازیابی نامعتبر یا منقضی شده است." });
    user.password = password;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();
    await redis.del("refresh_token:" + user._id);
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return res.json({ message: "رمز عبور تغییر کرد؛ اکنون وارد حساب شوید." });
  } catch (error) {
    console.error("Password reset failed", error.message);
    return res.status(500).json({ message: "تغییر رمز عبور ناموفق بود." });
  }
};

export const logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        await redis.del(`refresh_token:${decoded.userId}`);
      } catch (error) {
        if (!["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(error?.name)) throw error;
      }
    }
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout failed", { name: error?.name, message: error?.message });
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return res.status(503).json({ message: "Unable to complete logout right now" });
  }
};

// Rotate the refresh token atomically: only the request holding the current token
// can replace it, so parallel/replayed refresh requests cannot both succeed.
export const refreshToken = async (req, res) => {
  const presentedToken = req.cookies?.refreshToken;
  if (!presentedToken) {
    return res.status(401).json({ message: "Authentication session expired. Please sign in again." });
  }

  let decoded;
  try {
    decoded = verifyPresentedRefreshToken(presentedToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (error) {
    console.error("Refresh token verification failed", { name: error?.name, code: error?.code });
    return res.status(500).json({ message: "Unable to refresh session" });
  }
  if (!decoded) {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return res.status(401).json({ message: "Authentication session expired. Please sign in again." });
  }

  try {
    const user = await User.findById(decoded.userId).select("_id isActive");
    if (!isRefreshAccountActive(user)) {
      try {
        await redis.del(`refresh_token:${decoded.userId}`);
      } catch (error) {
        console.warn("Unable to revoke refresh token for inactive account", {
          name: error?.name || "Error",
          code: typeof error?.code === "string" ? error.code : undefined,
        });
        res.clearCookie("accessToken");
        res.clearCookie("refreshToken");
        return res.status(503).json({ message: "Session service is temporarily unavailable. Please try again." });
      }
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return res.status(401).json({ message: "Authentication session expired. Please sign in again." });
    }

    const { accessToken, refreshToken: nextRefreshToken } = generateTokens(decoded.userId);
    const rotated = await rotateStoredRefreshToken({
      redisClient: redis,
      userId: decoded.userId,
      presentedToken,
      nextRefreshToken,
    });
    if (!rotated) {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return res.status(401).json({ message: "Authentication session expired. Please sign in again." });
    }
    setCookies(res, accessToken, nextRefreshToken);
    return res.json({ message: "Session refreshed successfully" });
  } catch (error) {
    console.error("Refresh token rotation failed", { name: error?.name, code: error?.code });
    return res.status(503).json({ message: "Session service is temporarily unavailable. Please try again." });
  }
};

export const getProfile = async (req, res) => {
 try {
  const user = await User.findById(req.user._id).select("-password");
  if (!user) return res.status(404).json({ message: "حساب کاربری پیدا نشد." });
  if (ensureAddressBook(user)) await user.save();
  return res.json(user);
 } catch (error) {
  console.error("Loading customer profile failed", error.message);
  return res.status(500).json({ message: "دریافت اطلاعات پروفایل ناموفق بود." });
 }
};
