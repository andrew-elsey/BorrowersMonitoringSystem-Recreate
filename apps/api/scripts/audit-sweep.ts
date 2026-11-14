import { prisma } from '../src/lib/prisma.ts';
import { SWEEP_MAX_IDS } from '../src/lib/audit-sweep-sql.ts';
import { runAuditSweep } from '../src/services/audit-sweep.ts';

// Audit sweep (HRD-1, BR 14). Run inside the api container:
//   docker compose exec api npm run audit:sweep
// Read-only. Prints each problem with its count and up to 20 ids; exits 1 when it found any.

async function main(): Promise<void> {
  const findings = (await runAuditSweep()).filter((finding) => finding.count > 0);
  for (const { check, count, ids } of findings) {
    const more = count > ids.length ? `, first ${SWEEP_MAX_IDS} shown` : '';
    console.log(`${check}: ${count}${more}\n  ${ids.join('\n  ')}`);
  }
  console.log(findings.length ? '\nAudit sweep found problems.' : 'Audit sweep found no problems.');
  process.exitCode = findings.length ? 1 : 0;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
