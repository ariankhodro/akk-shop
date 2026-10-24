// Backup/restore verification helper.
//
//   MONGO_URI=<source> node scripts/verify-restore.mjs manifest --out file.json
//   MONGO_URI=<restored> node scripts/verify-restore.mjs compare --manifest file.json
//
// A manifest records per-collection document counts and an order-independent
// content fingerprint (XOR of per-document SHA-256 prefixes). `compare` exits
// non-zero if any collection differs, so a drill can be automated.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();
const [command, ...rest] = process.argv.slice(2);
const flag = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };

if (!process.env.MONGO_URI || !["manifest", "compare"].includes(command)) {
  console.error("Usage: MONGO_URI=... verify-restore.mjs manifest --out <file> | compare --manifest <file>");
  process.exit(2);
}

const fingerprint = async (collection) => {
  const parts = Buffer.alloc(8);
  let count = 0;
  for await (const document of collection.find({}, { sort: { _id: 1 } })) {
    const digest = createHash("sha256").update(JSON.stringify(document)).digest();
    for (let index = 0; index < 8; index += 1) parts[index] ^= digest[index];
    count += 1;
  }
  return { count, fingerprint: parts.toString("hex") };
};

const snapshot = async (db) => {
  const result = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("system.")) continue;
    result[name] = await fingerprint(db.collection(name));
  }
  return result;
};

try {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const current = await snapshot(db);
  if (command === "manifest") {
    await writeFile(flag("--out"), JSON.stringify({ database: db.databaseName, createdAt: new Date().toISOString(), collections: current }, null, 2));
    console.log(`Manifest written for ${Object.keys(current).length} collections.`);
  } else {
    const expected = JSON.parse(await readFile(flag("--manifest"), "utf8")).collections;
    const problems = [];
    for (const [name, want] of Object.entries(expected)) {
      const got = current[name];
      if (!got) problems.push(`${name}: missing`);
      else if (got.count !== want.count) problems.push(`${name}: count ${got.count} != ${want.count}`);
      else if (got.fingerprint !== want.fingerprint) problems.push(`${name}: content fingerprint differs`);
    }
    for (const name of Object.keys(current)) if (!expected[name]) problems.push(`${name}: unexpected extra collection`);
    if (problems.length) { console.error("RESTORE VERIFICATION FAILED:\n" + problems.join("\n")); process.exitCode = 1; }
    else console.log(`Restore verified: ${Object.keys(expected).length} collections match (counts and content fingerprints).`);
  }
} catch (error) {
  console.error("verify-restore failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
