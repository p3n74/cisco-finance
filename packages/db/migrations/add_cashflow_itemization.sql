-- Migration: Add cashflow line itemization table
-- IMPORTANT: Run this on your external database (do not run via mysql CLI in this project).
-- This migration corresponds to the Prisma model `CashflowLineItem` and its relation to `CashflowEntry`.

CREATE TABLE IF NOT EXISTS `cashflow_line_item` (
  `id`               VARCHAR(30)  NOT NULL,
  `cashflow_entry_id` VARCHAR(30) NOT NULL,
  `description`      VARCHAR(255) NOT NULL,
  `category`         VARCHAR(255) NOT NULL,
  `amount`           DECIMAL(19,4) NOT NULL,
  `notes`            TEXT NULL,
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `cashflow_line_item_cashflow_entry_id_fkey`
    FOREIGN KEY (`cashflow_entry_id`) REFERENCES `cashflow_entry`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- Index for quick lookup of items by parent cashflow entry
CREATE INDEX IF NOT EXISTS `cashflow_line_item_cashflow_entry_id_idx`
  ON `cashflow_line_item`(`cashflow_entry_id`);

