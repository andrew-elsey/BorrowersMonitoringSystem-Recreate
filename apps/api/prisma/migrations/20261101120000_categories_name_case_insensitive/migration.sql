-- Category names are unique regardless of letter case ("Audio" = "audio"), like rooms.
-- Owner decision for MD-1 on 2026-11-01. Prisma cannot express an index on lower(name).
DROP INDEX "categories_name_key";
CREATE UNIQUE INDEX "categories_name_lower_key" ON "categories" (lower("name"));
