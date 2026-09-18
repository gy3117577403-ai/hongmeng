// Fixture credentials are created only in explicitly disposable acceptance databases.
const { PrismaClient } = require("@prisma/client");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
async function createFixture(db) {
  if (process.env.PURCHASING_QA_ALLOW !== "disposable-purchasing-runtime")
    throw Error("Disposable purchasing runtime acknowledgement required");
  const marker = "PCQ-" + randomUUID().slice(0, 8),
    password = "Disposable-Purchasing-2026!";
  const department = await db.department.upsert({
    where: { code: "PRODUCTION" },
    create: { code: "PRODUCTION", name: "生产部" },
    update: {},
  });
  const user = await db.user.create({
    data: {
      username: marker,
      displayName: "采购验收员",
      passwordHash: await bcrypt.hash(password, 10),
      mustChangePassword: false,
      laborRole: "ADMIN",
      accessGrants: {
        create: {
          profile: "ADMIN_GLOBAL",
          departmentId: department.id,
          scopeKey: "GLOBAL:" + marker,
        },
      },
    },
  });
  return {
    marker,
    password,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
    date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
  };
}
module.exports = { createFixture };
if (require.main === module || module.id === "[stdin]") {
  const db = new PrismaClient();
  createFixture(db)
    .then((f) => console.log(JSON.stringify(f)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
