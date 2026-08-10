import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { AccessProfileKey, ProcessCompletionSource } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import {
  completeProcessStep,
  ProcessCompletionServiceError,
} from '../lib/process-completion-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'PIN consumption is atomic with completion and a consumed session only replays the same key',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITPIN-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let workOrderId: string | null = null;
    let terminalId: string | null = null;
    let employeeId: string | null = null;
    let userId: string | null = null;
    try {
      const employee = await prisma.employee.create({
        data: {
          employeeNo: `${prefix}-E`,
          name: `${prefix} employee`,
          department: '生产部',
          team: `${prefix}-TEAM`,
          isActive: true,
          attendanceEnabled: true,
        },
      });
      employeeId = employee.id;
      const user = await prisma.user.create({
        data: {
          username: `${prefix}-user`,
          passwordHash: 'integration-test-not-a-login-hash',
          displayName: `${prefix} field reporter`,
          employeeId: employee.id,
          accessGrants: {
            create: {
              profile: AccessProfileKey.FIELD_REPORTER,
              scopeKey: `EMPLOYEE:${employee.id}`,
            },
          },
        },
      });
      userId = user.id;
      const terminal = await prisma.fieldReportTerminal.create({
        data: {
          name: `${prefix} terminal`,
          secretHash: createHash('sha256').update(`${prefix}-terminal`).digest('hex'),
          version: 1,
        },
      });
      terminalId = terminal.id;
      const credential = await prisma.employeeFieldReportPinCredential.create({
        data: {
          employeeId: employee.id,
          pinHash: bcrypt.hashSync('integration-test-pin-material', 12),
          credentialVersion: 1,
        },
      });
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-WO`,
          productName: `${prefix} product`,
          stage: 'frontend',
          status: 'processing',
          processName: 'assembly',
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: new Date(),
          processRoute: {
            create: {
              templateName: `${prefix} route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              startedAt: new Date(),
              routeSource: 'integration_test',
              steps: {
                create: {
                  processCode: `${prefix}-ASSEMBLY`,
                  processName: 'assembly',
                  stageGroup: 'frontend',
                  position: 1,
                  sequenceGroup: 1,
                  standardSource: 'integration_test',
                  timeBasis: 'per_unit',
                  unitLabel: 'piece',
                  standardMillisecondsPerUnit: 1_000,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: true,
                  inputQty: 10,
                  status: 'current',
                  startedAt: new Date(),
                },
              },
            },
          },
        },
        include: { processRoute: { include: { steps: true } } },
      });
      workOrderId = order.id;
      assert.ok(order.processRoute);
      const ticket = await prisma.workOrderQrTicket.create({
        data: {
          workOrderId: order.id,
          publicCode: `${prefix}-PUBLIC-CODE`,
          status: 'ACTIVE',
        },
      });
      const tokenHash = createHash('sha256').update(`${prefix}-session`).digest('hex');
      const session = await prisma.fieldReportPinSession.create({
        data: {
          terminalId: terminal.id,
          terminalVersion: terminal.version,
          credentialId: credential.id,
          credentialVersion: credential.credentialVersion,
          employeeId: employee.id,
          userId: user.id,
          ticketId: ticket.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
      const evidence = {
        sessionId: session.id,
        tokenHash,
        terminalId: terminal.id,
        terminalVersion: terminal.version,
        credentialId: credential.id,
        credentialVersion: credential.credentialVersion,
        employeeId: employee.id,
        userId: user.id,
        ticketId: ticket.id,
      };
      const baseCommand = {
        routeId: order.processRoute.id,
        stepId: order.processRoute.steps[0].id,
        defectQty: 0,
        workDate: '2026-08-10',
        employeeIds: [employee.id],
        requireParticipants: true,
        reportSource: ProcessCompletionSource.SHARED_TERMINAL_PIN,
        principalEmployeeId: employee.id,
        fieldReportTerminalId: terminal.id,
        pinCredentialVersion: credential.credentialVersion,
        fieldReportPinSession: evidence,
        expectedRouteVersion: 0,
        userId: user.id,
        actor: `${employee.employeeNo} · ${employee.name}`,
      };

      await assert.rejects(
        completeProcessStep({
          ...baseCommand,
          processedQty: 11,
          idempotencyKey: `${prefix}-business-failure`,
        }),
        (error: unknown) => error instanceof ProcessCompletionServiceError
          && error.code === 'PROCESS_REPORTED_QTY_EXCEEDS_TARGET',
      );
      assert.equal((await prisma.fieldReportPinSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { consumedAt: true },
      })).consumedAt, null, 'business rollback must preserve the PIN session');

      const committed = await completeProcessStep({
        ...baseCommand,
        processedQty: 10,
        idempotencyKey: `${prefix}-committed`,
      });
      assert.ok((await prisma.fieldReportPinSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { consumedAt: true },
      })).consumedAt, 'successful completion must consume the PIN session');

      const replayed = await completeProcessStep({
        ...baseCommand,
        processedQty: 10,
        idempotencyKey: `${prefix}-committed`,
      });
      assert.equal(replayed.completionId, committed.completionId);
      assert.equal(await prisma.processCompletion.count({
        where: { workOrderId: order.id },
      }), 1);

      await assert.rejects(
        completeProcessStep({
          ...baseCommand,
          processedQty: 10,
          idempotencyKey: `${prefix}-different-key`,
        }),
        (error: unknown) => error instanceof ProcessCompletionServiceError
          && error.status === 401
          && error.code === 'PROCESS_COMPLETION_PIN_SESSION_INVALID',
      );
      assert.equal(await prisma.processCompletion.count({
        where: { workOrderId: order.id },
      }), 1);
    } finally {
      if (workOrderId) {
        const completions = await prisma.processCompletion.findMany({
          where: { workOrderId },
          select: { id: true },
        });
        const completionIds = completions.map(item => item.id);
        if (completionIds.length) {
          await prisma.processLaborClaim.deleteMany({
            where: { pool: { completionId: { in: completionIds } } },
          });
          await prisma.processLaborPool.deleteMany({
            where: { completionId: { in: completionIds } },
          });
          await prisma.processQuantityMovement.deleteMany({
            where: { completionId: { in: completionIds } },
          });
          await prisma.operationLog.deleteMany({
            where: { targetId: { in: completionIds } },
          });
          await prisma.processCompletion.deleteMany({ where: { id: { in: completionIds } } });
        }
        await prisma.workOrderProcessRoute.deleteMany({ where: { workOrderId } });
        await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      }
      if (terminalId) await prisma.fieldReportTerminal.deleteMany({ where: { id: terminalId } });
      if (userId) {
        await prisma.operationLog.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
  },
);
