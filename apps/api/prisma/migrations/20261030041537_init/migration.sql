-- CreateEnum
CREATE TYPE "role" AS ENUM ('ADMIN', 'HANDLER', 'VIEWER');

-- CreateEnum
CREATE TYPE "borrower_type" AS ENUM ('STUDENT', 'FACULTY', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "tracking_type" AS ENUM ('UNIT', 'QUANTITY');

-- CreateEnum
CREATE TYPE "item_condition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "item_status" AS ENUM ('ACTIVE', 'UNDER_REPAIR', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "return_condition" AS ENUM ('GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "flag_status" AS ENUM ('NONE', 'FLAGGED', 'OVERRIDDEN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrowers" (
    "id" UUID NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "borrower_type" NOT NULL,
    "department" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "borrowers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT,
    "tracking_type" "tracking_type" NOT NULL,
    "asset_tag" TEXT,
    "total_quantity" INTEGER NOT NULL,
    "condition" "item_condition" NOT NULL,
    "status" "item_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semesters" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "semesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "closing_time" TEXT NOT NULL DEFAULT '17:00',
    "warning_threshold" INTEGER NOT NULL DEFAULT 3,
    "notice_threshold" INTEGER NOT NULL DEFAULT 4,
    "block_threshold" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "borrower_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "issued_by" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "semester_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_borrowed" INTEGER NOT NULL,
    "quantity_returned" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "expected_return_date" DATE,
    "flag_status" "flag_status" NOT NULL DEFAULT 'NONE',
    "flagged_at" TIMESTAMPTZ(3),
    "override_by" UUID,
    "override_at" TIMESTAMPTZ(3),
    "override_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "transaction_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" UUID NOT NULL,
    "condition" "return_condition" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "borrowers_school_id_key" ON "borrowers"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "items_asset_tag_key" ON "items"("asset_tag");

-- CreateIndex
CREATE INDEX "transactions_borrower_id_semester_id_idx" ON "transactions"("borrower_id", "semester_id");

-- CreateIndex
CREATE INDEX "transaction_items_flag_status_idx" ON "transaction_items"("flag_status");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_created_at_idx" ON "audit_log"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_sid_key" ON "session"("sid");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "borrowers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_override_by_fkey" FOREIGN KEY ("override_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_transaction_item_id_fkey" FOREIGN KEY ("transaction_item_id") REFERENCES "transaction_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints and indexes Prisma cannot express (ARCHITECTURE.md section 8).
-- Written by hand. Keep in sync with the comments in schema.prisma.
-- ---------------------------------------------------------------------------

-- Items: UNIT items have an asset tag and quantity 1; QUANTITY items have no asset tag.
ALTER TABLE "items" ADD CONSTRAINT "items_unit_or_quantity_check" CHECK (
  ("tracking_type" = 'UNIT' AND "asset_tag" IS NOT NULL AND "total_quantity" = 1)
  OR ("tracking_type" = 'QUANTITY' AND "asset_tag" IS NULL AND "total_quantity" >= 0)
);

-- Lines: at least 1 borrowed; returned between 0 and borrowed.
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_quantity_check" CHECK (
  "quantity_borrowed" >= 1
  AND "quantity_returned" >= 0
  AND "quantity_returned" <= "quantity_borrowed"
);

-- Return events: at least 1 returned.
ALTER TABLE "returns" ADD CONSTRAINT "returns_quantity_check" CHECK ("quantity" >= 1);

-- Semesters: start on or before end, and exactly one current semester at a time.
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_dates_check" CHECK ("start_date" <= "end_date");
CREATE UNIQUE INDEX "semesters_one_current_key" ON "semesters" ("is_current") WHERE "is_current";

-- Settings: a single row.
ALTER TABLE "settings" ADD CONSTRAINT "settings_single_row_check" CHECK ("id" = 1);

-- Rooms and labs: name unique regardless of letter case.
CREATE UNIQUE INDEX "locations_name_lower_key" ON "locations" (lower("name"));

-- Open lines by item, used by the availability check (Rule 1).
CREATE INDEX "transaction_items_open_by_item_idx" ON "transaction_items" ("item_id")
  WHERE "quantity_returned" < "quantity_borrowed";
