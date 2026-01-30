import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router, whitelistedProcedure } from "../index";
import { WS_EVENTS } from "../context";
import { encryptChatMessage, decryptChatMessage } from "../services/chat-crypto";
import { env } from "@cisco-finance/env/server";

/**
 * Chat router: list conversations (all other users with last message), get messages, send message.
 * Messages are encrypted at rest with AES-256-GCM; only the server decrypts for the recipient/sender.
 * Open to any registered user (not limited to team members).
 */
export const chatRouter = router({
  // List conversations: all other registered users with last message preview (whitelisted only)
  listConversations: whitelistedProcedure.query(async ({ ctx }) => {
    const users = await ctx.prisma.user.findMany({
      where: { id: { not: ctx.session.user.id } },
      select: { id: true, name: true, email: true, image: true },
      orderBy: { name: "asc" },
    });

    const secret = env.CHAT_ENCRYPTION_KEY;
    const myId = ctx.session.user.id;

    const conversations: Array<{
      user: { id: string; name: string; email: string; image: string | null };
      lastMessage: { content: string; createdAt: Date; fromMe: boolean } | null;
      unreadCount: number;
    }> = [];

    for (const user of users) {
      const [lastMsg, unreadCount] = await Promise.all([
        ctx.prisma.chatMessage.findFirst({
          where: {
            OR: [
              { senderId: myId, receiverId: user.id },
              { senderId: user.id, receiverId: myId },
            ],
          },
          orderBy: { createdAt: "desc" },
        }),
        ctx.prisma.chatMessage.count({
          where: {
            senderId: user.id,
            receiverId: myId,
            readAt: null,
          },
        }),
      ]);

      let lastMessage: { content: string; createdAt: Date; fromMe: boolean } | null = null;
      if (lastMsg) {
        try {
          const content =
            lastMsg.senderId === myId
              ? decryptChatMessage(lastMsg.contentEncrypted, lastMsg.iv, secret)
              : decryptChatMessage(lastMsg.contentEncrypted, lastMsg.iv, secret);
          lastMessage = {
            content: content.length > 80 ? content.slice(0, 80) + "…" : content,
            createdAt: lastMsg.createdAt,
            fromMe: lastMsg.senderId === myId,
          };
        } catch {
          lastMessage = { content: "[Unable to decrypt]", createdAt: lastMsg.createdAt, fromMe: lastMsg.senderId === myId };
        }
      }

      conversations.push({ user, lastMessage, unreadCount });
    }

    // Sort by last message time (most recent first)
    conversations.sort((a, b) => {
      const tA = a.lastMessage?.createdAt?.getTime() ?? 0;
      const tB = b.lastMessage?.createdAt?.getTime() ?? 0;
      return tB - tA;
    });

    return { conversations };
  }),

  // Get messages between current user and another user (decrypted)
  getMessages: whitelistedProcedure
    .input(
      z.object({
        otherUserId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const myId = ctx.session.user.id;
      const other = await ctx.prisma.user.findFirst({
        where: { id: input.otherUserId },
        select: { id: true, name: true, image: true },
      });
      if (!other) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const messages = await ctx.prisma.chatMessage.findMany({
        where: {
          OR: [
            { senderId: myId, receiverId: input.otherUserId },
            { senderId: input.otherUserId, receiverId: myId },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          sender: { select: { id: true, name: true, image: true } },
          receiver: { select: { id: true, name: true, image: true } },
        },
      });

      // Mark messages I received in this conversation as read
      const receivedIds = messages.filter((m) => m.receiverId === myId && !m.readAt).map((m) => m.id);
      if (receivedIds.length > 0) {
        await ctx.prisma.chatMessage.updateMany({
          where: { id: { in: receivedIds } },
          data: { readAt: new Date() },
        });
      }

      const secret = env.CHAT_ENCRYPTION_KEY;
      const nextCursor = messages.length > input.limit ? messages[input.limit - 1].id : null;
      const items = messages.slice(0, input.limit);

      const decrypted = items.map((m) => {
        let content: string;
        try {
          content = decryptChatMessage(m.contentEncrypted, m.iv, secret);
        } catch {
          content = "[Unable to decrypt]";
        }
        return {
          id: m.id,
          senderId: m.senderId,
          receiverId: m.receiverId,
          content,
          createdAt: m.createdAt,
          sender: m.sender,
          receiver: m.receiver,
        };
      });

      return {
        otherUser: { id: other.id, name: other.name, image: other.image },
        messages: decrypted.reverse(),
        nextCursor,
      };
    }),

  // Total unread count for the current user (for badge on chat button)
  getUnreadCount: whitelistedProcedure.query(async ({ ctx }) => {
    const count = await ctx.prisma.chatMessage.count({
      where: {
        receiverId: ctx.session.user.id,
        readAt: null,
      },
    });
    return { count };
  }),

  // Send a message (encrypt, store, then emit via WS to receiver)
  sendMessage: whitelistedProcedure
    .input(
      z.object({
        receiverId: z.string(),
        content: z.string().min(1).max(10000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const receiver = await ctx.prisma.user.findFirst({
        where: { id: input.receiverId },
        select: { id: true },
      });
      if (!receiver) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (input.receiverId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot message yourself" });
      }

      const secret = env.CHAT_ENCRYPTION_KEY;
      const { ciphertext, iv } = encryptChatMessage(input.content, secret);

      const message = await ctx.prisma.chatMessage.create({
        data: {
          senderId: ctx.session.user.id,
          receiverId: input.receiverId,
          contentEncrypted: ciphertext,
          iv,
        },
        include: {
          sender: { select: { id: true, name: true, image: true } },
          receiver: { select: { id: true, name: true, image: true } },
        },
      });

      ctx.ws?.emitToUser(input.receiverId, {
        event: WS_EVENTS.CHAT_MESSAGE_NEW,
        action: "created",
        entityId: message.id,
      });

      return {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        content: input.content,
        createdAt: message.createdAt,
        sender: message.sender,
        receiver: message.receiver,
      };
    }),
});
