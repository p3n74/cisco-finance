import type { QueryClient } from "@tanstack/react-query";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import type { trpc } from "@/utils/trpc";

import Header from "@/components/header";
import { BackgroundProvider, useBackground } from "@/components/background-provider";
import { ChatPopup } from "@/components/chat-popup";
import { TabTitleUnread } from "@/components/tab-title-unread";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { WebSocketProvider } from "@/components/websocket-provider";

import "../index.css";

function BgWrapper({ children }: { children: React.ReactNode }) {
  const bg = useBackground();
  return (
    <div
      className="bg-image flex h-svh min-w-0 flex-col overflow-x-hidden"
      data-bg={bg?.bgIndex ?? 1}
    >
      {children}
    </div>
  );
}

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "TRACE",
      },
      {
        name: "description",
        content: "Modern finance management for your organization",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/cisco-face-primary.ico",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <WebSocketProvider>
          <BackgroundProvider>
            <TabTitleUnread />
            <BgWrapper>
              <Header className="shrink-0" />
              <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-6 sm:pb-8">
                <Outlet />
              </main>
            </BgWrapper>
          </BackgroundProvider>
          <ChatPopup />
        </WebSocketProvider>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
