import { audit } from '../src/lib/audit.ts';
import { prisma } from '../src/lib/prisma.ts';
import { checkPasswordPolicy, hashPassword } from '../src/lib/password.ts';

// Emergency password reset (ARCHITECTURE.md 12.4). Run inside the api container:
//   docker compose exec api npm run admin:reset-password -- <username>
// The new password is typed at a hidden prompt, so it never lands in shell history.

export class ResetPasswordError extends Error {}

export async function resetPassword(username: string, newPassword: string): Promise<void> {
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) throw new ResetPasswordError(policyError);

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new ResetPasswordError(`No user named "${username}".`);

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Rule 14. A null actor: this runs from the command line, not as a signed-in user. The hash is never logged.
    await audit(tx, {
      actorId: null,
      action: 'USER_PASSWORD_RESET',
      entity: 'user',
      entityId: user.id,
      after: { username, resetFrom: 'command line' },
    });
  });
}

// Reads one line from the terminal without echoing it.
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    throw new ResetPasswordError(
      'Run this in an interactive terminal (docker compose exec gives one).',
    );
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let input = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(input);
          return;
        }
        if (char === '\u0003') {
          finish();
          reject(new ResetPasswordError('Cancelled.'));
          return;
        }
        if (char === '\u007f' || char === '\b') input = input.slice(0, -1);
        else input += char;
      }
    };
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  try {
    const username = process.argv[2];
    if (!username)
      throw new ResetPasswordError('Usage: npm run admin:reset-password -- <username>');

    const newPassword = await promptHidden(`New password for ${username}: `);
    const repeated = await promptHidden('Repeat the new password: ');
    if (newPassword !== repeated) throw new ResetPasswordError('The passwords do not match.');

    await resetPassword(username, newPassword);
    console.log(`Password for ${username} was reset.`);
  } catch (error) {
    console.error(error instanceof ResetPasswordError ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when started as a script, not when imported by the tests.
if (import.meta.main) await main();
