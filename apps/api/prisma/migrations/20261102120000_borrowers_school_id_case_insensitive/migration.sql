-- School IDs are unique regardless of letter case ("2026-A01" = "2026-a01"), like category names.
-- Owner decision for MD-5 on 2026-11-02. Prisma cannot express an index on lower(school_id).
DROP INDEX "borrowers_school_id_key";
CREATE UNIQUE INDEX "borrowers_school_id_lower_key" ON "borrowers" (lower("school_id"));
