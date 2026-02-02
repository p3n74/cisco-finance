-- AlterTable
ALTER TABLE "budget_item" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'expense';

-- CreateTable
CREATE TABLE "budget_item_income" (
    "id" TEXT NOT NULL,
    "budget_item_id" TEXT NOT NULL,
    "cashflow_entry_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_item_income_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_item_income_budget_item_id_idx" ON "budget_item_income"("budget_item_id");

-- CreateIndex
CREATE INDEX "budget_item_income_cashflow_entry_id_idx" ON "budget_item_income"("cashflow_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_item_income_budget_item_id_cashflow_entry_id_key" ON "budget_item_income"("budget_item_id", "cashflow_entry_id");

-- CreateIndex
CREATE INDEX "budget_item_type_idx" ON "budget_item"("type");

-- AddForeignKey
ALTER TABLE "budget_item_income" ADD CONSTRAINT "budget_item_income_budget_item_id_fkey" FOREIGN KEY ("budget_item_id") REFERENCES "budget_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_item_income" ADD CONSTRAINT "budget_item_income_cashflow_entry_id_fkey" FOREIGN KEY ("cashflow_entry_id") REFERENCES "cashflow_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
