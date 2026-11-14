-- SEC-2 load data: 5,000 borrowers, 500 items, 20,000 transactions and 100,000+ audit rows.
-- Run only through seed.ts, against the throwaway `bms-load` compose project. It is plain SQL
-- (not through the API) so it is set-based and fast; the rule 1 scan does not cover it.
-- Needs the first admin, which the api creates on its first start.
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN
  IF current_database() NOT LIKE '%load%' THEN
    RAISE EXCEPTION 'Refusing to seed: database "%" has no "load" in its name.', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'ADMIN') THEN
    RAISE EXCEPTION 'No admin yet: start the api first.';
  END IF;
  IF EXISTS (SELECT 1 FROM categories WHERE name = 'Load') THEN
    RAISE EXCEPTION 'Already seeded. Run "docker compose -p bms-load down -v" first.';
  END IF;
END $$;

CREATE TEMP TABLE admin AS SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1;

INSERT INTO categories (id, name, updated_at) VALUES (gen_random_uuid(), 'Load', now());
INSERT INTO locations (id, name, created_by, updated_at)
  SELECT gen_random_uuid(), 'Load room', id, now() FROM admin;
-- Only when the stack has no current semester yet (a real seed creates none).
INSERT INTO semesters (id, name, start_date, end_date, is_current, updated_at)
  SELECT gen_random_uuid(), 'Load semester', current_date - 400, current_date + 200, true, now()
  WHERE NOT EXISTS (SELECT 1 FROM semesters WHERE is_current);

-- Borrowers L-1..L-4950 have the transactions; LC-1..LC-50 stay clean for the load clients.
INSERT INTO borrowers (id, school_id, name, type, department, updated_at)
  SELECT gen_random_uuid(),
         CASE WHEN n <= 4950 THEN 'L-' || n ELSE 'LC-' || (n - 4950) END,
         'Load Borrower ' || n, (ARRAY['STUDENT','FACULTY','EMPLOYEE'])[n % 3 + 1]::borrower_type,
         'Dept ' || (n % 20), now()
  FROM generate_series(1, 5000) AS n;

-- Items 1..450 are UNIT, 451..500 QUANTITY (stock 20). Name is "Load item <n>".
INSERT INTO items (id, name, category_id, tracking_type, asset_tag, total_quantity, condition, updated_at)
  SELECT gen_random_uuid(), 'Load item ' || n, (SELECT id FROM categories WHERE name = 'Load'),
         CASE WHEN n <= 450 THEN 'UNIT' ELSE 'QUANTITY' END::tracking_type,
         CASE WHEN n <= 450 THEN 'LOAD-' || n END,
         CASE WHEN n <= 450 THEN 1 ELSE 20 END, 'GOOD', now()
  FROM generate_series(1, 500) AS n;

CREATE TEMP TABLE bn AS SELECT id, substring(school_id from 3)::int AS num FROM borrowers WHERE school_id LIKE 'L-%';
CREATE TEMP TABLE it AS SELECT id, substring(name from 11)::int AS num FROM items;

-- Transactions spread over the last 360 days. Borrower L-1 gets 2,000 of them (a long history page).
CREATE TEMP TABLE t AS
  SELECT n, gen_random_uuid() AS id,
         CASE WHEN n % 10 = 0 THEN 1 ELSE n % 4949 + 2 END AS borrower_n,
         now() - interval '1 day' * (n * 360.0 / 20000) AS issued_at
  FROM generate_series(1, 20000) AS n;

INSERT INTO transactions (id, borrower_id, location_id, issued_by, issued_at, semester_id, updated_at)
  SELECT t.id, bn.id, (SELECT id FROM locations WHERE name = 'Load room'), (SELECT id FROM admin),
         t.issued_at, (SELECT id FROM semesters WHERE is_current), now()
  FROM t JOIN bn ON bn.num = t.borrower_n;

-- One line per transaction, a second on every fourth. Item 1 gets 2,000 lines. 5% of first lines
-- stay open (never returned); every second open line is already FLAGGED, the rest wait for the run.
CREATE TEMP TABLE l AS
  SELECT gen_random_uuid() AS id, t.id AS tid, t.n, w, t.issued_at,
         CASE WHEN w = 2 THEN (t.n + 250) % 500 + 1
              WHEN t.n % 10 = 0 THEN 1 ELSE t.n % 500 + 1 END AS item_n,
         (w = 1 AND t.n % 20 = 0) AS is_open, (w = 1 AND t.n % 40 = 0) AS is_flagged
  FROM t, LATERAL generate_series(1, CASE WHEN t.n % 4 = 0 THEN 2 ELSE 1 END) AS w;
ALTER TABLE l ADD COLUMN qty int;
UPDATE l SET qty = CASE WHEN item_n <= 450 THEN 1 ELSE n % 3 + 1 END;

INSERT INTO transaction_items (id, transaction_id, item_id, quantity_borrowed, quantity_returned,
                               flag_status, flagged_at, updated_at)
  SELECT l.id, l.tid, it.id, l.qty, CASE WHEN l.is_open THEN 0 ELSE l.qty END,
         CASE WHEN l.is_flagged THEN 'FLAGGED' ELSE 'NONE' END::flag_status,
         CASE WHEN l.is_flagged THEN least(now(), l.issued_at + interval '1 day') END, now()
  FROM l JOIN it ON it.num = l.item_n;

CREATE TEMP TABLE r AS
  SELECT gen_random_uuid() AS id, l.id AS lid, l.qty, l.issued_at + interval '1 minute' AS at
  FROM l WHERE NOT l.is_open;
INSERT INTO returns (id, transaction_item_id, quantity, returned_at, received_by, condition, updated_at)
  SELECT id, lid, qty, at, (SELECT id FROM admin), 'GOOD', now() FROM r;

-- Audit rows like the real code writes: CHECKOUT per transaction, RETURN per return, LINE_FLAGGED per
-- flagged line, plus 60,000 ITEM_UPDATED rows so the table reaches 100,000+ rows (the worst case).
INSERT INTO audit_log (id, actor_id, action, entity, entity_id, after, created_at)
  SELECT gen_random_uuid(), (SELECT id FROM admin), 'CHECKOUT', 'transaction', id::text,
         jsonb_build_object('id', id), issued_at FROM t;
INSERT INTO audit_log (id, actor_id, action, entity, entity_id, after, created_at)
  SELECT gen_random_uuid(), (SELECT id FROM admin), 'RETURN', 'return', id::text,
         jsonb_build_object('id', id, 'lineId', lid, 'quantity', qty), at FROM r;
INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before, after, created_at)
  SELECT gen_random_uuid(), NULL, 'LINE_FLAGGED', 'transaction_item', id::text,
         '{"flagStatus":"NONE"}', '{"flagStatus":"FLAGGED"}', least(now(), issued_at + interval '1 day')
  FROM l WHERE is_flagged;
INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before, after, created_at)
  SELECT gen_random_uuid(), (SELECT id FROM admin), 'ITEM_UPDATED', 'item', it.id::text,
         '{"condition":"GOOD"}', '{"condition":"GOOD"}', now() - interval '1 day' * (n * 360.0 / 60000)
  FROM generate_series(1, 60000) AS n JOIN it ON it.num = n % 500 + 1;

COMMIT;
ANALYZE;
SELECT (SELECT count(*) FROM borrowers) AS borrowers, (SELECT count(*) FROM items) AS items,
       (SELECT count(*) FROM transactions) AS transactions, (SELECT count(*) FROM transaction_items) AS lines,
       (SELECT count(*) FROM audit_log) AS audit_rows;
