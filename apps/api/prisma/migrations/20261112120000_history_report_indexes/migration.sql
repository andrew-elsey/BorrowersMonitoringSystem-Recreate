-- RPT-2: borrower history filters by borrower and issue date (ARCHITECTURE.md 12.5).
CREATE INDEX "transactions_borrower_id_issued_at_idx" ON "transactions"("borrower_id", "issued_at");
