import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useEffect, useState } from "react";
import { MessageCircle, ArrowLeft, Search, Send, Bell } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PresenceStatusIndicator } from "@/components/presence-status";
import { usePresence } from "@/hooks/usePresence";
import { queryClient, trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";

const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 480;

export function ChatPopup() {
  const { data: session } = authClient.useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const unreadOptions = trpc.chat.getUnreadCount.queryOptions();
  const { data: unreadData } = useQuery({
    ...unreadOptions,
    enabled: !!session,
  });

  const conversationsOptions = trpc.chat.listConversations.queryOptions();
  const { data: conversationsData } = useQuery({
    ...conversationsOptions,
    enabled: !!session && isOpen,
  });

  const messagesOptions = trpc.chat.getMessages.queryOptions({
    otherUserId: selectedUserId ?? "",
    limit: 80,
  });
  const { data: messagesData } = useQuery({
    ...messagesOptions,
    enabled: !!session && isOpen && !!selectedUserId,
  });

  const pingUser = useMutation(
    trpc.chat.pingUser.mutationOptions({
      onError: (err) => {
        toast.error(err.message ?? "Failed to ping");
      },
    })
  );

  const sendMessage = useMutation(
    trpc.chat.sendMessage.mutationOptions({
      onSuccess: (newMessage, variables) => {
        setInputValue("");
        // Append the new message to the getMessages cache so it appears immediately
        const messagesQueryKey = trpc.chat.getMessages.queryOptions({
          otherUserId: variables.receiverId,
          limit: 80,
        }).queryKey;
        queryClient.setQueryData(messagesQueryKey, (prev: { messages: unknown[]; otherUser?: unknown; nextCursor?: unknown } | undefined) => {
          if (!prev?.messages) return prev;
          return {
            ...prev,
            messages: [...prev.messages, newMessage],
          };
        });
        queryClient.invalidateQueries({ queryKey: trpc.chat.listConversations.queryOptions().queryKey });
        queryClient.invalidateQueries({ queryKey: trpc.chat.getUnreadCount.queryOptions().queryKey });
      },
      onError: (err) => {
        toast.error(err.message ?? "Failed to send message");
      },
    })
  );

  const allConversations = conversationsData?.conversations ?? [];
  const searchLower = searchQuery.trim().toLowerCase();
  const conversations = searchLower
    ? allConversations.filter(
        (c) =>
          (c.user.name ?? "").toLowerCase().includes(searchLower) ||
          (c.user.email ?? "").toLowerCase().includes(searchLower)
      )
    : allConversations;
  const presenceUserIds = [
    ...allConversations.map((c) => c.user.id),
    ...(selectedUserId ? [selectedUserId] : []),
  ].filter((id, i, arr) => arr.indexOf(id) === i);
  const { statuses: presenceStatuses } = usePresence(presenceUserIds, !!session && isOpen);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesData?.messages?.length]);

  // After opening a conversation and messages load, server marks as read — refresh unread badge
  useEffect(() => {
    if (selectedUserId && messagesData != null) {
      queryClient.invalidateQueries({ queryKey: trpc.chat.getUnreadCount.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: trpc.chat.listConversations.queryOptions().queryKey });
    }
  }, [selectedUserId, messagesData != null]);

  const handleSend = () => {
    const content = inputValue.trim();
    if (!content || !selectedUserId) return;
    sendMessage.mutate({ receiverId: selectedUserId, content });
  };

  if (!session) return null;

  const myId = session.user?.id;
  const messages = messagesData?.messages ?? [];
  const otherUser = messagesData?.otherUser;
  const unreadCount = unreadData?.count ?? 0;
  const showBadge = unreadCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="relative z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 hover:shadow-xl"
        style={{ position: "fixed", bottom: "1.5rem", right: "1.5rem", left: "auto" }}
        aria-label={showBadge ? `Open messages (${unreadCount} unread)` : "Open messages"}
      >
        <MessageCircle className="h-6 w-6" />
        {showBadge && (
          <span className="absolute -right-1 -top-1 flex min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-xs font-bold text-destructive-foreground ring-2 ring-background">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="z-50 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl backdrop-blur-sm"
          style={{ position: "fixed", bottom: "5rem", right: "1.5rem", left: "auto", width: POPUP_WIDTH, height: POPUP_HEIGHT }}
        >
          {selectedUserId ? (
            <>
              <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => { setSelectedUserId(null); setInputValue(""); }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="relative shrink-0">
                    {otherUser?.image ? (
                      <img
                        src={otherUser.image}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary">
                        {otherUser?.name?.slice(0, 1) ?? "?"}
                      </div>
                    )}
                    {selectedUserId && (
                      <span className="absolute bottom-0 right-0">
                        <PresenceStatusIndicator status={presenceStatuses[selectedUserId] ?? "offline"} size="sm" />
                      </span>
                    )}
                  </div>
                  <span className="truncate text-sm font-medium">{otherUser?.name ?? "User"}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => selectedUserId && pingUser.mutate({ receiverId: selectedUserId })}
                  disabled={pingUser.isPending}
                  title="Ping (play notification sound)"
                  aria-label="Ping"
                >
                  <Bell className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((m) => {
                  const fromMe = m.senderId === myId;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex",
                        fromMe ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] min-w-0 break-words rounded-2xl px-3 py-2 text-sm",
                          fromMe
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        )}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2 border-t border-border/60 p-2">
                <Input
                  placeholder="Type a message..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  className="flex-1 rounded-xl"
                />
                <Button
                  size="icon"
                  className="shrink-0 rounded-xl"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || sendMessage.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold">Messages</h3>
                <p className="text-xs text-muted-foreground">Start or continue a conversation</p>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 rounded-lg bg-muted/50 pl-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                    <MessageCircle className="h-10 w-10 opacity-50" />
                    {searchLower ? (
                      <>
                        <p>No one matches &quot;{searchQuery.trim()}&quot;</p>
                        <p>Try a different name or email.</p>
                      </>
                    ) : (
                      <>
                        <p>No conversations yet.</p>
                        <p>Use the search above to find someone to message.</p>
                      </>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y divide-border/40">
                    {conversations.map(({ user, lastMessage, unreadCount: convUnread }) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
                        >
                          <div className="relative shrink-0">
                            {user.image ? (
                              <img
                                src={user.image}
                                alt=""
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary">
                                {user.name?.slice(0, 1) ?? "?"}
                              </div>
                            )}
                            {convUnread > 0 && (
                              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                                {convUnread > 99 ? "99+" : convUnread}
                              </span>
                            )}
                            <span className="absolute bottom-0 right-0">
                              <PresenceStatusIndicator status={presenceStatuses[user.id] ?? "offline"} size="sm" />
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={cn("truncate text-sm", convUnread > 0 && "font-semibold")}>
                              {user.name}
                            </p>
                            {lastMessage ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {lastMessage.fromMe ? "You: " : ""}{lastMessage.content}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">No messages yet</p>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
