-- The audit sweep (HRD-1) and the history reports look up the returns of a line.
CREATE INDEX "returns_transaction_item_id_idx" ON "returns"("transaction_item_id");
