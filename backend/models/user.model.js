import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { getPasswordPolicyError } from "../lib/password-policy.js";
import { PERMISSIONS, LEGACY_WILDCARD, ROLE_PRESET_NAMES } from "../lib/rbac.js";

const BCRYPT_COST = Number.isInteger(Number(process.env.BCRYPT_COST)) && Number(process.env.BCRYPT_COST) >= 10 && Number(process.env.BCRYPT_COST) <= 14 ? Number(process.env.BCRYPT_COST) : 12;

const shippingAddressFields = {
 recipientName: { type: String, trim: true, minlength: 2, maxlength: 100, required: true },
 phone: { type: String, trim: true, match: /^09\d{9}$/, required: true },
 province: { type: String, trim: true, maxlength: 80, required: true },
 city: { type: String, trim: true, minlength: 2, maxlength: 80, required: true },
 district: { type: String, trim: true, maxlength: 80, default: "" },
 addressLine: { type: String, trim: true, minlength: 10, maxlength: 500, required: true },
 postalCode: { type: String, trim: true, match: /^\d{10}$/, required: true },
 notes: { type: String, trim: true, maxlength: 500, default: "" },
};

const defaultShippingAddressSchema = new mongoose.Schema(shippingAddressFields, { _id: false });
const savedShippingAddressSchema = new mongoose.Schema({
 label: { type: String, trim: true, minlength: 2, maxlength: 60, default: "نشانی من" },
 ...shippingAddressFields,
 isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const userSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: [true, "Name is required"],
			trim: true,
			minlength: 2,
			maxlength: 100,
		},
		email: {
			type: String,
			required: [true, "Email is required"],
			unique: true,
			lowercase: true,
			trim: true,
			maxlength: 254,
			match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email is invalid"],
		},
		password: {
			type: String,
			required: [true, "Password is required"],
			minlength: [12, "Password must be at least 12 characters long"],
			validate: {
				validator(value) {
					return !this.isModified("password") || getPasswordPolicyError(value) === "";
				},
				message: (props) => getPasswordPolicyError(props.value) || "Password does not meet the required strength policy",
			},
		},
		passwordResetTokenHash: { type: String, select: false },
		passwordResetExpiresAt: { type: Date, select: false },
    defaultShippingAddress: { type: defaultShippingAddressSchema, default: undefined },
    savedShippingAddresses: { type: [savedShippingAddressSchema], default: [] },
		cartItems: [
			{
				quantity: {
					type: Number,
					default: 1,
				},
				product: {
					type: mongoose.Schema.Types.ObjectId,
					ref: "Product",
				},
				size: { type: String, trim: true, default: "" },
				color: { type: String, trim: true, default: "" },
			},
		],
		role: {
			type: String,
			enum: ["customer", "admin"],
			default: "customer",
		},
    // Explicit permission list. Missing or empty grants nothing (deny by default).
    // The legacy wildcard is still accepted by the schema only so old documents
    // can be loaded and migrated; it is ignored at authorization time.
    permissions: {
      type: [{ type: String, enum: [...PERMISSIONS, LEGACY_WILDCARD] }],
      default: undefined,
    },
    // Informational label of the preset the permissions were derived from.
    adminRole: { type: String, enum: ROLE_PRESET_NAMES, default: undefined },
    // Owner tier: set only by the bootstrap script or by an existing owner.
    isOwner: { type: Boolean, default: false },
    // Incremented to revoke every outstanding access and refresh token.
    tokenVersion: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
	},
	{
		timestamps: true,
	}
);

// Pre-save hook to hash password before saving to database
userSchema.pre("save", async function (next) {
	if (!this.isModified("password")) return next();

	try {
		const salt = await bcrypt.genSalt(BCRYPT_COST);
		this.password = await bcrypt.hash(this.password, salt);
		next();
	} catch (error) {
		next(error);
	}
});

userSchema.methods.comparePassword = async function (password) {
	return bcrypt.compare(password, this.password);
};

// Spend the same bcrypt time for unknown accounts so response time does not
// reveal whether an email is registered.
let dummyHashPromise = null;
userSchema.statics.burnPasswordCheck = async function (password) {
	dummyHashPromise ??= bcrypt.hash("timing-equalisation-placeholder", BCRYPT_COST);
	await bcrypt.compare(typeof password === "string" ? password : "", await dummyHashPromise);
	return false;
};

const User = mongoose.model("User", userSchema);

export default User;
