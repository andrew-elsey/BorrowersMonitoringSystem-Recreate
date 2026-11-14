-- HRD-5a: BR 11 warning < notice < block, enforced by the database as well as the API.
-- This fails on a database whose settings row is already out of order. The API has enforced the
-- order since MD-7 and the seed uses 3/4/5, so that is not expected; fix the row first if it happens.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_threshold_order"
  CHECK ("warning_threshold" < "notice_threshold" AND "notice_threshold" < "block_threshold");
