-- Asset tags are unique regardless of letter case ("LT-001" = "lt-001"), like school IDs.
-- Owner decision for MD-2 on 2026-11-03. Prisma cannot express an index on lower(asset_tag).
DROP INDEX "items_asset_tag_key";
CREATE UNIQUE INDEX "items_asset_tag_lower_key" ON "items" (lower("asset_tag"));
