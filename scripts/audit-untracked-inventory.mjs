import dotenv from "dotenv";
import mongoose from "mongoose";
import Product from "../backend/models/product.model.js";
import { hasConfiguredInventory } from "../backend/lib/inventory-stock.js";

dotenv.config();

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI must be configured to inspect the catalogue.");
  process.exit(1);
}

const stockProblem = (value) => {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value !== "number") return "wrong-type";
  if (!Number.isSafeInteger(value)) return "not-a-safe-integer";
  if (value < 0) return "negative";
  return null;
};

const result = {
  audit: "read-only active-product inventory audit",
  generatedAt: new Date().toISOString(),
  activeProductsScanned: 0,
  productsWithUntrackedInventory: 0,
  invalidVariantRecords: 0,
  findings: [],
  policy: "Unknown stock is not unlimited stock. Assign a verified non-negative integer quantity to each sellable product/variant before enabling checkout.",
};

try {
  await mongoose.connect(process.env.MONGO_URI);
  const cursor = Product.find({ isActive: { $ne: false } })
    .select("_id name category categoryId stock variants isActive")
    .lean()
    .cursor({ batchSize: 250 });

  for await (const product of cursor) {
    result.activeProductsScanned += 1;
    if (hasConfiguredInventory(product)) continue;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const finding = {
      productId: String(product._id),
      name: typeof product.name === "string" ? product.name : "",
      category: typeof product.category === "string" ? product.category : "",
      inventoryMode: variants.length ? "variants" : "product",
      untrackedFields: [],
    };

    if (variants.length) {
      variants.forEach((variant, index) => {
        const issue = stockProblem(variant?.stock);
        if (!issue) return;
        result.invalidVariantRecords += 1;
        finding.untrackedFields.push({
          variantIndex: index,
          size: typeof variant?.size === "string" ? variant.size : "",
          color: typeof variant?.color === "string" ? variant.color : "",
          stockState: issue,
        });
      });
    } else {
      const issue = stockProblem(product.stock);
      finding.untrackedFields.push({ field: "stock", stockState: issue || "unknown" });
    }

    result.productsWithUntrackedInventory += 1;
    result.findings.push(finding);
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.productsWithUntrackedInventory > 0) process.exitCode = 2;
} catch (error) {
  console.error("Inventory audit failed:", {
    name: error?.name || "Error",
    code: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : undefined,
  });
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
