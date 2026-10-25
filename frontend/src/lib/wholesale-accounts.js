import { getPasswordPolicyError } from "./password-policy";

// Random temporary password that satisfies the store password policy. The
// account holder must replace it on first sign-in.
export const generateTemporaryPassword = () => {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*-_+=?"];
  const all = groups.join("");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const random = new Uint32Array(16);
    window.crypto.getRandomValues(random);
    const chars = Array.from(random, (value, index) => {
      const pool = index < groups.length ? groups[index] : all;
      return pool[value % pool.length];
    });
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swap = random[index] % (index + 1);
      [chars[index], chars[swap]] = [chars[swap], chars[index]];
    }
    const password = chars.join("");
    if (!getPasswordPolicyError(password)) return password;
  }
  return "";
};

export const emptyWholesaleProfile = () => ({ companyName: "", contactPhone: "", taxId: "", city: "", discountPercent: "0", notes: "" });

export const wholesaleProfilePayload = (value) => ({
  companyName: value.companyName.trim(),
  contactPhone: value.contactPhone.trim(),
  taxId: value.taxId.trim(),
  city: value.city.trim(),
  notes: value.notes.trim(),
  discountPercent: value.discountPercent === "" ? 0 : Number(value.discountPercent),
});

