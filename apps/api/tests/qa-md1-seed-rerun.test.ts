import { beforeEach, expect, test } from 'vitest';
import { seed } from '../prisma/seed.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA gap test for MD-1 x FND-4: category names are now unique regardless of case, and MD-1 lets an
// admin change a category's own case. The seed must stay safe to re-run (FND-4) after that.

beforeEach(resetDatabase);

const options = {
  adminUsername: 'admin',
  adminPassword: 'first-password',
  includeSampleData: true,
};

test('the seed stays safe to re-run after an admin changes the case of a sample category', async () => {
  await seed(options);
  // What PUT /api/categories/:id { name: 'LAPTOPS' } does (allowed by TC-MD-24).
  await prisma.category.updateMany({ where: { name: 'Laptops' }, data: { name: 'LAPTOPS' } });

  await expect(seed(options)).resolves.toBeTypeOf('number');
  expect(
    await prisma.category.count({ where: { name: { equals: 'laptops', mode: 'insensitive' } } }),
  ).toBe(1);
});
