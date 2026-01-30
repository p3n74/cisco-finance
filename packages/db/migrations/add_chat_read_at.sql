-- Add read tracking for chat messages (unread notifications)
-- Run on your database after add_chat_messages.sql.

ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "chat_message_receiverId_readAt_idx" ON "chat_message"("receiverId", "readAt");
