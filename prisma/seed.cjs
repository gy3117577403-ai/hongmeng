const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 64;
const COMMON_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '654321',
  'password',
  'password1',
  'admin123',
  'qwerty123',
  '11111111',
]);

// Keep this in sync with lib/password-policy.ts. The parity test covers the
// shared rules because the production seed is executed by plain Node.js.
function validateSeedAdminPassword(password, username) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `密码至少 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `密码最多 ${MAX_PASSWORD_LENGTH} 位`;
  }
  const normalized = password.trim().toLowerCase();
  if (!normalized || COMMON_PASSWORDS.has(normalized)) {
    return '密码过于常见，请更换后重试';
  }
  if (/^(.)\1+$/.test(password)) {
    return '密码不能全部使用相同字符';
  }
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (normalizedUsername && normalized.includes(normalizedUsername)) {
    return '密码不能包含完整登录账号';
  }
  return null;
}

function requiresSeedAdminPassword(existingAdmin, resetAdminPassword) {
  return !existingAdmin || resetAdminPassword;
}

function isAdminAccountActive(admin) {
  return admin.isActive === true && admin.accountStatus === 'ACTIVE';
}

async function ensureAdminGlobalGrant(tx, admin) {
  const desiredActive = isAdminAccountActive(admin);
  const existingGrant = await tx.userAccessGrant.findFirst({
    where: {
      userId: admin.id,
      profile: 'ADMIN_GLOBAL',
      departmentId: null,
      scopeKey: 'GLOBAL',
      grantType: 'PRIMARY',
      effectiveTo: null,
    },
    orderBy: { effectiveFrom: 'asc' },
  });

  if (!existingGrant) {
    return tx.userAccessGrant.create({
      data: {
        userId: admin.id,
        profile: 'ADMIN_GLOBAL',
        departmentId: null,
        scopeKey: 'GLOBAL',
        grantType: 'PRIMARY',
        isActive: desiredActive,
      },
    });
  }

  if (existingGrant.isActive !== desiredActive) {
    return tx.userAccessGrant.update({
      where: { id: existingGrant.id },
      data: {
        isActive: desiredActive,
        version: { increment: 1 },
      },
    });
  }

  return existingGrant;
}

async function seedAdmin(prisma, options = {}) {
  const env = options.env || process.env;
  const hashPassword = options.hashPassword || (password => bcrypt.hash(password, 10));
  const username = String(env.SEED_ADMIN_USERNAME || 'admin').trim();
  const resetAdminPassword = env.SEED_RESET_ADMIN_PASSWORD === 'true';

  if (!username) {
    throw new Error('SEED_ADMIN_USERNAME 不能为空');
  }

  const existingAdmin = await prisma.user.findUnique({ where: { username } });
  if (existingAdmin && !resetAdminPassword && existingAdmin.laborRole !== 'ADMIN') {
    throw new Error(
      'SEED_ADMIN_USERNAME 已被非管理员账号占用；如需明确提升为管理员，请提供强密码并设置 SEED_RESET_ADMIN_PASSWORD=true',
    );
  }
  const passwordRequired = requiresSeedAdminPassword(existingAdmin, resetAdminPassword);
  let passwordHash;

  if (passwordRequired) {
    const password = env.SEED_ADMIN_PASSWORD;
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(
        '首次创建或显式重置管理员时，必须通过 SEED_ADMIN_PASSWORD 提供强密码',
      );
    }
    const passwordError = validateSeedAdminPassword(password, username);
    if (passwordError) {
      throw new Error(`SEED_ADMIN_PASSWORD 不符合密码策略：${passwordError}`);
    }
    passwordHash = await hashPassword(password);
  }

  return prisma.$transaction(async tx => {
    let admin;
    let action;

    if (!existingAdmin) {
      admin = await tx.user.create({
        data: {
          username,
          passwordHash,
          displayName: '管理员',
          isActive: true,
          accountStatus: 'ACTIVE',
          mustChangePassword: true,
          laborRole: 'ADMIN',
          employeeId: null,
        },
      });
      action = 'created';
    } else if (resetAdminPassword) {
      admin = await tx.user.update({
        where: { id: existingAdmin.id },
        data: {
          passwordHash,
          isActive: true,
          accountStatus: 'ACTIVE',
          mustChangePassword: true,
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
          laborRole: 'ADMIN',
          employeeId: null,
        },
      });
      action = 'reset';
    } else if (existingAdmin.employeeId !== null) {
      admin = await tx.user.update({
        where: { id: existingAdmin.id },
        data: {
          employeeId: null,
        },
      });
      action = 'confirmed';
    } else {
      admin = existingAdmin;
      action = 'unchanged';
    }

    const grant = await ensureAdminGlobalGrant(tx, admin);
    return { admin, grant, action };
  });
}

async function main(prisma, env = process.env) {
  const seedSampleWorkOrders = env.SEED_SAMPLE_WORK_ORDERS === 'true';
  const adminResult = await seedAdmin(prisma, { env });
  console.log(`admin seed ${adminResult.action}`);

  const categories = [
    ['原图', 'drawing', 1],
    ['SOP指导书', 'sop', 2],
    ['成品图', 'product', 3],
    ['辅料规格', 'material', 4],
    ['注意事项', 'notice', 5],
    ['剥皮参数', 'sample_parameters', 6],
    ['样品过程图', 'sample_process', 7],
    ['测量证据', 'sample_measurement', 8],
  ];

  for (const [name, code, sortOrder] of categories) {
    await prisma.resourceCategory.upsert({
      where: { code },
      create: { name, code, sortOrder },
      update: { name, sortOrder },
    });
  }

  if (seedSampleWorkOrders) {
    const orders = [
      ['WO-20250520-001', '新能源电池线束总成', 'frontend', 75, 'urgent', 'processing'],
      ['WO-20250520-002', '车门线束（左前门）', 'backend', 40, 'high', 'processing'],
      ['WO-20250520-003', '座椅线束总成', 'not_issued', 0, 'normal', 'pending'],
      ['WO-20250519-008', '仪表台线束总成', 'backend', 60, 'high', 'processing'],
      ['WO-20250518-007', '发动机线束总成', 'frontend', 90, 'urgent', 'processing'],
      ['WO-20250518-006', '尾门线束总成', 'not_issued', 0, 'normal', 'pending'],
    ];

    for (const [code, productName, stage, progress, priority, status] of orders) {
      const exists = await prisma.workOrder.findUnique({ where: { code } });
      if (!exists) {
        await prisma.workOrder.create({
          data: { code, productName, stage, progress, priority, status },
        });
      }
    }
  } else {
    console.log('sample work orders skipped');
  }

  console.log('seed completed');
}

module.exports = {
  isAdminAccountActive,
  main,
  requiresSeedAdminPassword,
  seedAdmin,
  validateSeedAdminPassword,
};

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
