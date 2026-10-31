import { PERMISSIONS, type Permission, type Role } from '@bms/shared';
import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { getSessionMiddleware } from '../src/lib/session.ts';
import { requireFetchHeader, requireRole } from '../src/middleware/auth.ts';
import { errorHandler } from '../src/middleware/errors.ts';
import { createAuthRouter } from '../src/routes/auth.ts';
import { resetDatabase } from './setup/reset-database.ts';

// SPEC.md 3, copied by hand so this test checks PERMISSIONS against the spec, not against itself.
const SPEC_TABLE: Record<Permission, Record<Role, boolean>> = {
  checkoutAndReturn: { ADMIN: true, HANDLER: true, VIEWER: false },
  addLocationAtCheckout: { ADMIN: true, HANDLER: true, VIEWER: false },
  editLineNote: { ADMIN: true, HANDLER: true, VIEWER: false },
  viewDashboardAndReports: { ADMIN: true, HANDLER: true, VIEWER: true },
  manageMasterData: { ADMIN: true, HANDLER: false, VIEWER: false },
  manageUsers: { ADMIN: true, HANDLER: false, VIEWER: false },
  manageSettingsAndSemesters: { ADMIN: true, HANDLER: false, VIEWER: false },
  overrideFlags: { ADMIN: true, HANDLER: false, VIEWER: false },
  runFlaggingJob: { ADMIN: true, HANDLER: false, VIEWER: false },
  viewAuditLog: { ADMIN: true, HANDLER: false, VIEWER: false },
  changeOwnPassword: { ADMIN: true, HANDLER: true, VIEWER: true },
};
const ROLES: Role[] = ['ADMIN', 'HANDLER', 'VIEWER'];
const PASSWORD = 'correct-horse-battery';

// The real session and login stack plus one probe route per capability, guarded the way
// feature routes will be. The probes stand in until the feature endpoints exist.
function createProbeApp() {
  const app = express();
  app.use(express.json());
  app.use(requireFetchHeader, getSessionMiddleware());
  app.use('/api', createAuthRouter());
  for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
    app.get(`/probe/${permission}`, requireRole(...PERMISSIONS[permission]), (_req, res) => {
      res.json({ ok: true });
    });
  }
  app.use(errorHandler);
  return app;
}

let app: ReturnType<typeof createProbeApp>;
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.createMany({
    data: ROLES.map((role) => ({ name: role, username: role.toLowerCase(), passwordHash, role })),
  });
  app = createProbeApp();
});

async function signedInAs(role: Role) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username: role.toLowerCase(), password: PASSWORD })
    .expect(200);
  return agent;
}

test('PERMISSIONS matches the table in SPEC.md 3', () => {
  for (const [permission, roles] of Object.entries(PERMISSIONS)) {
    const expected = ROLES.filter((role) => SPEC_TABLE[permission as Permission][role]);
    expect([...roles].sort(), permission).toEqual(expected.sort());
  }
});

describe.each(ROLES)('signed in as %s', (role) => {
  test('every capability is allowed or refused with 403 FORBIDDEN per SPEC.md 3', async () => {
    const agent = await signedInAs(role);
    for (const permission of Object.keys(SPEC_TABLE) as Permission[]) {
      const response = await agent.get(`/probe/${permission}`);
      if (SPEC_TABLE[permission][role]) {
        expect(response.status, permission).toBe(200);
      } else {
        expect(response.status, permission).toBe(403);
        expect(response.body.error).toEqual({
          code: 'FORBIDDEN',
          message: 'You do not have permission to do this.',
          details: {},
        });
      }
    }
  });
});

// BUSINESS_RULES.md S18, one line per bullet.
test.each([
  ['a handler calling override gets 403', 'HANDLER', 'overrideFlags', 403],
  ['a view-only user calling checkout gets 403', 'VIEWER', 'checkoutAndReturn', 403],
  ['a handler cannot open user management', 'HANDLER', 'manageUsers', 403],
  ['a view-only user can load the dashboard and reports', 'VIEWER', 'viewDashboardAndReports', 200],
] as const)('S18: %s', async (_name, role, permission, status) => {
  const agent = await signedInAs(role);
  expect((await agent.get(`/probe/${permission}`)).status).toBe(status);
});

test('a signed-out request gets 401 UNAUTHENTICATED, not 403', async () => {
  const response = await request(app).get('/probe/viewDashboardAndReports');
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('UNAUTHENTICATED');
});
