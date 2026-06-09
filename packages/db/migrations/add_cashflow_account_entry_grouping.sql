-- Migration: Add grouped verification links between cashflow and account entries.
-- IMPORTANT: Run this on your external database (do not run via mysql CLI in this project).

CREATE TABLE IF NOT EXISTS `cashflow_account_entry_link` (
  `id`                VARCHAR(30)  NOT NULL,
  `cashflow_entry_id` VARCHAR(30)  NOT NULL,
  `account_entry_id`  VARCHAR(30)  NOT NULL,
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `cashflow_account_entry_link_cashflow_entry_id_fkey`
    FOREIGN KEY (`cashflow_entry_id`) REFERENCES `cashflow_entry`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `cashflow_account_entry_link_account_entry_id_fkey`
    FOREIGN KEY (`account_entry_id`) REFERENCES `account_entry`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- Enforce "one account entry belongs to one grouped cashflow"
CREATE UNIQUE INDEX IF NOT EXISTS `cashflow_account_entry_link_account_entry_id_key`
  ON `cashflow_account_entry_link`(`account_entry_id`);

-- Prevent duplicate pairs
CREATE UNIQUE INDEX IF NOT EXISTS `cashflow_account_entry_link_cashflow_entry_id_account_entry_id_key`
  ON `cashflow_account_entry_link`(`cashflow_entry_id`, `account_entry_id`);

CREATE INDEX IF NOT EXISTS `cashflow_account_entry_link_cashflow_entry_id_idx`
  ON `cashflow_account_entry_link`(`cashflow_entry_id`);

-- Backfill legacy 1:1 verified rows into the new link table
INSERT INTO `cashflow_account_entry_link` (`id`, `cashflow_entry_id`, `account_entry_id`)
SELECT
  CONCAT('cal', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 27)) AS id,
  ce.`id` AS cashflow_entry_id,
  ce.`account_entry_id` AS account_entry_id
FROM `cashflow_entry` ce
WHERE ce.`account_entry_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `cashflow_account_entry_link` l
    WHERE l.`account_entry_id` = ce.`account_entry_id`
  );
