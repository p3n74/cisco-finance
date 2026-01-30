-- Team chat: direct messages between users (encrypted at rest)
-- Run this on your external database when ready.

CREATE TABLE IF NOT EXISTS "chat_message" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "senderId" TEXT NOT NULL,
  "receiverId" TEXT NOT NULL,
  "contentEncrypted" TEXT NOT NULL,
  "iv" VARCHAR(24) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_message_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "chat_message_senderId_receiverId_idx" ON "chat_message"("senderId", "receiverId");
CREATE INDEX IF NOT EXISTS "chat_message_receiverId_senderId_idx" ON "chat_message"("receiverId", "senderId");
CREATE INDEX IF NOT EXISTS "chat_message_createdAt_idx" ON "chat_message"("createdAt");
