// Shared helpers for the MongoDB integration tests of the payment/inventory flows.
// Importing this file registers connect/cleanup hooks for the importing test file.
import { after, afterEach, before } from "node:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import mongoose from "mongoose";
import Coupon, { CouponRedemption, CouponUserUsage } from "../../models/coupon.model.js";
import Order, { CheckoutGuard } from "../../models/order.model.js";
import Product from "../../models/product.model.js";
import ServiceCase from "../../models/service-case.model.js";
import User from "../../models/user.model.js";
import { zarinpalDeps } from "../../controllers/zarinpal.controller.js";

export const testUri = process.env.MONGO_TEST_URI || "";
const dbName = (() => {
  try { return new URL(testUri).pathname.replace(/^\//, "").split("?")[0]; }
  catch { return ""; }
})();
if (testUri && !/(^|[_-])test($|[_-])/i.test(dbName)) {
  throw new Error("MONGO_TEST_URI must point to a dedicated disposable database whose name includes 'test'.");
}

export const setPaymentEnv = () => {
  process.env.CLIENT_URL = "https://shop.test";
  process.env.API_URL = "https://api.shop.test";
  process.env.ZARINPAL_MERCHANT_ID = "00000000-0000-0000-0000-000000000000";
  process.env.IRT_CATALOG_PRICES_CONFIRMED = "true";
  process.env.ZARINPAL_SANDBOX = "true";
  process.env.CRON_SECRET = "c".repeat(40);
};

const created = { users: [], products: [], orders: [], coupons: [], cases: [] };
let originalFetch;

export const useDatabase = ({ clearAll = false } = {}) => {
  before(async () => {
    if (!testUri) return;
    setPaymentEnv();
    originalFetch = zarinpalDeps.fetch;
    // node --test runs files in parallel processes: give each file its own disposable
    // database (the base name was already checked to contain "test") so the global
    // reconciler runs and lease lock of one file never see another file's orders.
    const suffix = basename(process.argv[1] || String(process.pid)).replace(/[^A-Za-z0-9]+/g, "_").slice(-24);
    await mongoose.connect(testUri, { dbName: `${dbName}_${suffix}`.slice(0, 63) });
    // Make sure unique/partial indexes exist before concurrency tests rely on them.
    await Promise.all([Order, Coupon, CouponRedemption, CouponUserUsage, ServiceCase, CheckoutGuard, Product, User].map((model) => model.init()));
  });
  afterEach(async () => {
    zarinpalDeps.fetch = originalFetch;
    zarinpalDeps.now = () => Date.now();
    if (!testUri || mongoose.connection.readyState !== 1) return;
    if (clearAll) {
      await Promise.all([Order, Coupon, CouponRedemption, CouponUserUsage, ServiceCase, CheckoutGuard, Product, User]
        .map((model) => model.deleteMany({})));
    } else {
      await Order.deleteMany({ $or: [{ _id: { $in: created.orders } }, { user: { $in: created.users } }] });
      await Product.deleteMany({ _id: { $in: created.products } });
      await Coupon.deleteMany({ _id: { $in: created.coupons } });
      await CouponRedemption.deleteMany({ coupon: { $in: created.coupons } });
      await CouponUserUsage.deleteMany({ coupon: { $in: created.coupons } });
      await ServiceCase.deleteMany({ _id: { $in: created.cases } });
      await User.deleteMany({ _id: { $in: created.users } });
      await CheckoutGuard.deleteMany({ _id: { $in: created.users } });
    }
    for (const key of Object.keys(created)) created[key] = [];
  });
  after(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase().catch(() => {});
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
};

export const makeRes = () => {
  const res = {
    statusCode: 200, body: null, redirectedTo: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    send(body) { res.body = body; return res; },
    redirect(url) { res.redirectedTo = url; return res; },
  };
  return res;
};

export const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const fixtureResponse = (name) => {
  const { http, body } = JSON.parse(readFileSync(new URL(`../fixtures/zarinpal/${name}.json`, import.meta.url), "utf8"));
  return jsonResponse(http, body);
};

// Installs a mock provider. `handler(url, body)` returns a Response (or throws).
export const mockProvider = (handler) => {
  const calls = [];
  zarinpalDeps.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body });
    return handler(String(url), body);
  };
  return calls;
};

let sequence = 0;
const unique = () => `${Date.now().toString(36)}${(sequence += 1)}`;

export const createUser = async (overrides = {}) => {
  const user = await User.create({
    name: "Test User",
    email: `user-${unique()}@example.test`,
    password: "Str0ng!Passphrase-for-tests",
    ...overrides,
  });
  created.users.push(user._id);
  return user;
};

export const createProduct = async ({ stock = 10, variants = [], price = 1000, ...rest } = {}) => {
  const product = await Product.create({
    name: "Harness product",
    description: "Fixture product for integration tests.",
    price,
    category: "test-category",
    stock: variants.length ? null : stock,
    variants,
    isActive: true,
    ...rest,
  });
  created.products.push(product._id);
  return product;
};

export const createCoupon = async (overrides = {}) => {
  const coupon = await Coupon.create({
    code: `T-${unique().toUpperCase()}`,
    discountPercentage: 10,
    startsAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 86_400_000),
    reservedCount: 0,
    usageCount: 0,
    isActive: true,
    ...overrides,
  });
  created.coupons.push(coupon._id);
  return coupon;
};

// A pending order that holds `quantity` units of `product` (the stock decrement is applied here).
export const createReservedOrder = async (product, {
  user, quantity = 2, authority = `A${unique()}`.padEnd(36, "0"), paymentStatus = "pending",
  stockReserved = true, decrement = true, coupon = null, expiresAt = new Date(Date.now() + 30 * 60_000), ...overrides
} = {}) => {
  const owner = user || await createUser();
  if (decrement && stockReserved) await Product.updateOne({ _id: product._id }, { $inc: { stock: -quantity } });
  const order = await Order.create({
    user: owner._id,
    products: [{ product: product._id, quantity, price: product.price, size: "", color: "", hasVariant: false, stockReserved }],
    totalAmount: product.price * quantity,
    paymentProvider: "zarinpal",
    paymentStatus,
    status: paymentStatus,
    paymentRequestStatus: "accepted",
    zarinpalAuthority: authority,
    expiresAt,
    couponCode: coupon?.code || "",
    couponReservationStatus: coupon ? "reserved" : "none",
    ...overrides,
  });
  if (coupon) await Coupon.updateOne({ _id: coupon._id }, { $inc: { reservedCount: 1 } });
  created.orders.push(order._id);
  return order;
};

export const trackOrder = (order) => { created.orders.push(order._id); return order; };
export const trackCase = (serviceCase) => { created.cases.push(serviceCase._id); return serviceCase; };

export const validShippingAddress = {
  recipientName: "Test Recipient",
  phone: "09123456789",
  province: "Tehran",
  city: "Tehran",
  addressLine: "Valiasr street, building 10, unit 4",
  postalCode: "1234567890",
};

export const checkoutRequest = (user, extra = {}) => ({
  user,
  body: { shippingAddress: validShippingAddress, ...extra },
});

export const callbackRequest = (order, query = {}) => ({
  query: { Authority: order.zarinpalAuthority, order_id: String(order._id), ...query },
});
