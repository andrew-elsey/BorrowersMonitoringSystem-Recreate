-- Owner decisions for MD-7 on 2026-11-03. Prisma cannot express either constraint.
-- Semester names are unique regardless of letter case, like categories and rooms.
CREATE UNIQUE INDEX "semesters_name_lower_key" ON "semesters" (lower("name"));
-- Semesters never overlap. Start and end are inclusive dates ('[]'), so a semester ending on the
-- day another starts overlaps it. A GiST index on daterange needs no extension.
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_no_overlap"
  EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);
