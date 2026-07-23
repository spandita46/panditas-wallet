import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Walmart Master Card + Costco CIBC Card ids from earlier context
const cardIds = {
  "Walmart Master Card": "cmrofuyq000kuymh3x3xezvt7",
  "Costco CIBC Card": "cmrofuyr000n4ymh3vdxw6hhn",
};

for (const [label, id] of Object.entries(cardIds)) {
  console.log(`\n=== ${label} (${id}) — transactions with positive amount (incoming) ===`);
  const incoming = await prisma.transaction.findMany({
    where: { accountId: id, amount: { gt: 0 } },
    include: { category: true },
    orderBy: { postedAt: "desc" },
    take: 10,
  });
  for (const t of incoming) {
    console.log(`${t.postedAt.toISOString().slice(0,10)} | amt=${t.amount} | payee="${t.payee}" | cat=${t.category?.name ?? "UNCAT"} | xferAcct=${t.transferAccountId ?? ""}`);
  }
  if (incoming.length === 0) console.log("  (none)");
}

console.log("\n=== Transactions category = Credit Card Payment, showing source + linked card ===");
const payments = await prisma.transaction.findMany({
  where: { category: { name: "Credit Card Payment" } },
  include: { account: true, transferAccount: true },
  orderBy: { postedAt: "desc" },
  take: 10,
});
for (const t of payments) {
  console.log(`${t.postedAt.toISOString().slice(0,10)} | ${t.account.label ?? t.account.name} amt=${t.amount} -> transferAccount=${t.transferAccount ? (t.transferAccount.label ?? t.transferAccount.name) : "NONE"}`);
}

await prisma.$disconnect();
