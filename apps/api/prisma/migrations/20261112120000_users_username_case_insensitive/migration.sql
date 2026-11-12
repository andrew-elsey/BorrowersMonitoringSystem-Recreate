-- Usernames are unique regardless of letter case ("BNavarro" = "bnavarro"), like category names.
-- Owner decision for AUTH-3 on 2026-11-12. Prisma cannot express an index on lower(username).
-- Unlike categories, the exact index "users_username_key" stays: sign-in still matches the
-- username exactly as typed and uses it.

-- If two existing accounts differ only in case, stop before changing anything and name them, so
-- no account is renamed behind anyone's back. Rename one (UPDATE users SET username = ...), run
-- `npx prisma migrate resolve --rolled-back 20261112120000_users_username_case_insensitive`, then
-- deploy again (ARCHITECTURE.md 8).
DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(names, '; ') INTO clashes
  FROM (
    SELECT string_agg(username, ', ' ORDER BY username) AS names
    FROM users
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) AS duplicates;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'Usernames that differ only in letter case must be renamed first: %', clashes;
  END IF;
END $$;

CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));
