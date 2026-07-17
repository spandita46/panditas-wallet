import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const prisma = new PrismaClient();
const hash = (s: string) => argon2.hash(s, { type: argon2.argon2id });

// Starter expense categories tuned to how the family's cards are segmented.
const CATEGORIES = [
  { name: "Groceries", group: "Essentials" },
  { name: "Gas & Transport", group: "Essentials" },
  { name: "Shopping", group: "Lifestyle" },
  { name: "Kids", group: "Family" },
  { name: "Dining & Takeout", group: "Lifestyle" },
  { name: "Bills & Utilities", group: "Essentials" },
  { name: "Car Loan", group: "Debt" },
  { name: "Investments & Savings", group: "Savings" },
];

async function main(): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@panditas.local";
  // No password default — require it via env so no credential is ever baked into source.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 8) {
    throw new Error("Set SEED_ADMIN_PASSWORD (min 8 chars) in .env before seeding.");
  }

  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: adminName,
      email: adminEmail,
      role: "admin",
      passwordHash: await hash(adminPassword),
    },
  });
  console.log(`✓ admin user: ${adminEmail} (password from SEED_ADMIN_PASSWORD — change after first login)`);

  // Example kid + piggy bank (daughter). Update the PIN after seeding.
  const daughter = await prisma.user.upsert({
    where: { id: "seed-daughter" },
    update: {},
    create: {
      id: "seed-daughter",
      name: "Daughter",
      role: "kid",
      avatarEmoji: "🦄",
      pinHash: await hash("1234"),
    },
  });
  await prisma.account.upsert({
    where: { id: "seed-piggy-daughter" },
    update: {},
    create: {
      id: "seed-piggy-daughter",
      name: "Piggy Bank",
      type: "piggy_bank",
      isManual: true,
      ownerUserId: daughter.id,
      currentBalance: 0,
    },
  });

  // Manual accounts SimpleFIN cannot reach.
  const manualAccounts = [
    { id: "seed-coinbase", name: "Coinbase (Polkadot)", type: "investment" as const, balance: 100 },
    { id: "seed-pocket-cash", name: "Pocket Cash", type: "cash" as const, balance: 0 },
  ];
  for (const a of manualAccounts) {
    await prisma.account.upsert({
      where: { id: a.id },
      update: {},
      create: { id: a.id, name: a.name, type: a.type, isManual: true, currentBalance: a.balance },
    });
  }

  for (const [i, c] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { id: `seed-cat-${i}` },
      update: {},
      create: { id: `seed-cat-${i}`, name: c.name, group: c.group, sortOrder: i },
    });
  }

  console.log(`✓ seeded ${CATEGORIES.length} categories, kid + piggy bank, and manual accounts`);
  void admin;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
