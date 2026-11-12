-- RPT-3: item history reads every line of an item, open or not (ARCHITECTURE.md 12.5).
CREATE INDEX "transaction_items_item_id_idx" ON "transaction_items"("item_id");
