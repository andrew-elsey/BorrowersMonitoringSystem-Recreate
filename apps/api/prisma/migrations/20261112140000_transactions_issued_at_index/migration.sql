-- RPT-4: reports filter transactions by issue date (ARCHITECTURE.md 8 and 12.5).
-- IF NOT EXISTS: another Sprint 5 report ticket may add the same index.
CREATE INDEX IF NOT EXISTS "transactions_issued_at_idx" ON "transactions"("issued_at");
