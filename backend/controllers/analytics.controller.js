import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js";
import { recordAuditEvent } from "../lib/audit-log.js";

const paidOrderMatch = (startDate, endDate) => ({
  currency: "IRT",
  paymentProvider: "zarinpal",
  paymentStatus: "paid",
  createdAt: { $gte: startDate, $lte: endDate },
});

export const getAnalyticsData = async (startDate, endDate) => {
  const [users, products, salesData] = await Promise.all([
    User.countDocuments(),
    Product.countDocuments({ isActive: { $ne: false } }),
    Order.aggregate([
      { $match: paidOrderMatch(startDate, endDate) },
      { $group: { _id: null, totalSales: { $sum: 1 }, totalRevenue: { $sum: "$totalAmount" } } },
    ]),
  ]);
  const { totalSales, totalRevenue } = salesData[0] || { totalSales: 0, totalRevenue: 0 };
  return { users, products, totalSales, totalRevenue, revenueBasis: "gross-paid-orders" };
};

export const getDailySalesData = async (startDate, endDate) => {
  const dailySalesData = await Order.aggregate([
    { $match: paidOrderMatch(startDate, endDate) },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Tehran" } },
        sales: { $sum: 1 },
        revenue: { $sum: "$totalAmount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const byDate = new Map(dailySalesData.map((item) => [item._id, item]));
  return getDatesInRange(startDate, endDate).map((date) => {
    const item = byDate.get(date);
    return { date, sales: item?.sales || 0, revenue: item?.revenue || 0 };
  });
};

function getDatesInRange(startDate, endDate) {
  const calendarDate = (date) => {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
  };
  const start = calendarDate(startDate);
  const end = calendarDate(endDate);
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const last = Date.UTC(end.year, end.month - 1, end.day);
  const dates = [];
  while (cursor <= last) {
    const date = new Date(cursor);
    dates.push(String(date.getUTCFullYear()).padStart(4, "0") + "-" +
      String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(date.getUTCDate()).padStart(2, "0"));
    cursor += 24 * 60 * 60 * 1000;
  }
  return dates;
}


const csvCell = (value) => {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet formula execution when an exported field begins with a formula marker.
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};

export const exportSalesCsv = async (req, res) => {
  const requestedDays = Number(req.query.days);
  const days = [7, 30, 90, 365].includes(requestedDays) ? requestedDays : 30;
  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const filter = { ...paidOrderMatch(startDate, endDate) };
    const count = await Order.countDocuments(filter).maxTimeMS(2000);
    if (count > 10000) {
      return res.status(400).json({ message: "The selected period contains too many orders to export. Choose a shorter period." });
    }
    const orders = await Order.find(filter)
      .populate("user", "name email")
      .sort({ createdAt: -1, _id: -1 })
      .limit(10000)
      .maxTimeMS(5000)
      .lean();
    const columns = [
      "order_id", "created_at", "customer_name", "customer_email", "currency",
      "payment_status", "shipment_status", "subtotal", "shipping_fee",
      "coupon_code", "coupon_discount", "total_amount", "zarinpal_ref_id",
    ];
    const rows = orders.map((order) => [
      order._id, order.createdAt, order.user?.name, order.user?.email, order.currency,
      order.paymentStatus, order.shipmentStatus, order.subtotalAmount, order.shippingFee,
      order.couponCode, order.couponDiscountAmount, order.totalAmount, order.zarinpalRefId,
    ]);
    // The export contains customer names and emails: record who pulled it. A failed
    // audit write blocks the download rather than allowing an untraceable export.
    await recordAuditEvent(req, {
      action: "analytics.exported", targetType: "report", targetId: "sales-csv",
      summary: "Sales report CSV exported",
      metadata: { days, rows: orders.length, containsPersonalData: true },
    }, { strict: true });
    const csv = "\uFEFF" + [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tik-boutique-sales-${days}d-${endDate.toISOString().slice(0, 10)}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(csv);
  } catch (error) {
    console.error("Sales CSV export failed", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Sales report export failed. Please try again." });
  }
};
