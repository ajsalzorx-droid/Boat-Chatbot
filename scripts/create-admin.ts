/**
 * Secure bootstrap and maintenance of admin accounts. There is no public sign-up endpoint: accounts
 * can only be created by someone with server access (database credentials) running this script.
 *
 * Usage:
 *   npm run admin:create -- --email owner@company.ae --name "Owner Name" --role owner
 *   npm run admin:create -- --email agent@company.ae --name "Agent" --role agent
 *   npm run admin:create -- --email owner@company.ae --reset-password
 *   npm run admin:create -- --email agent@company.ae --deactivate
 *   npm run admin:create -- --email owner@company.ae --password "chosen password"   (create or reset)
 *
 * A strong random password is generated and printed ONCE. Share it privately; the user should
 * change it under "My account" after the first sign-in.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { checkPasswordStrength, hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db/mongoose";
import { ADMIN_ROLES, AdminUser, type AdminRole } from "@/models/admin-user";

function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "agent" },
      password: { type: "string" },
      "reset-password": { type: "boolean", default: false },
      deactivate: { type: "boolean", default: false },
    },
  });

  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid --email");

  const chosen = values.password;
  if (chosen !== undefined) {
    const problem = checkPasswordStrength(chosen, email);
    if (problem) console.warn(`Warning: password does not meet the sign-in policy (${problem}) Setting it anyway.`);
  }

  await connectToDatabase();
  await AdminUser.createIndexes();
  const existing = await AdminUser.findOne({ email }).lean();

  if (values.deactivate) {
    if (!existing) throw new Error("No such user");
    await AdminUser.updateOne({ _id: existing._id }, { $set: { active: false } });
    await revokeAllSessions(existing._id);
    console.log(`Deactivated ${email} and signed out all sessions.`);
    return;
  }

  if (values["reset-password"] || (chosen !== undefined && existing)) {
    if (!existing) throw new Error("No such user");
    const password = chosen ?? generatePassword();
    await AdminUser.updateOne(
      { _id: existing._id },
      { $set: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), active: true } },
    );
    await revokeAllSessions(existing._id);
    console.log(`Password reset for ${email}. Temporary password (shown once):\n\n  ${password}\n`);
    return;
  }

  if (existing) throw new Error("User already exists. Use --reset-password or --deactivate.");
  const role = values.role as AdminRole;
  if (!(ADMIN_ROLES as readonly string[]).includes(role)) throw new Error(`--role must be one of ${ADMIN_ROLES.join(", ")}`);
  const name = values.name?.trim() || email.split("@")[0] || "Admin";

  const password = chosen ?? generatePassword();
  await AdminUser.create({ email, name, role, passwordHash: await hashPassword(password), active: true });
  console.log(`Created ${role} ${email}. Temporary password (shown once):\n\n  ${password}\n\nSign in at /login and change it under "My account".`);
}

main()
  .catch((error: unknown) => {
    console.error("Failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
