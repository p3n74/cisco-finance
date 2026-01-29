-- Migration: Add receipt binding to cashflow entries
-- Run this SQL on your external database

-- Add cashflowEntryId column to receipt_submission table
ALTER TABLE `receipt_submission` 
ADD COLUMN `cashflowEntryId` VARCHAR(191) NULL,
ADD COLUMN `boundAt` DATETIME(3) NULL,
ADD COLUMN `boundBy` VARCHAR(191) NULL;

-- Add foreign key constraint
ALTER TABLE `receipt_submission`
ADD CONSTRAINT `receipt_submission_cashflowEntryId_fkey` 
FOREIGN KEY (`cashflowEntryId`) REFERENCES `cashflow_entry`(`id`) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for performance
CREATE INDEX `receipt_submission_cashflowEntryId_idx` ON `receipt_submission`(`cashflowEntryId`);

-- Remove old status column (optional - run this after confirming the new system works)
-- ALTER TABLE `receipt_submission` DROP COLUMN `status`;
-- ALTER TABLE `receipt_submission` DROP COLUMN `reviewedAt`;
-- ALTER TABLE `receipt_submission` DROP COLUMN `reviewedBy`;
