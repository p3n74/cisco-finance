import type { QueryClient } from "@tanstack/react-query";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import type { trpc } from "@/utils/trpc";

import Header from "@/components/header";
import { ChatPopup } from "@/components/chat-popup";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { WebSocketProvider } from "@/components/websocket-provider";

import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "Cisco Finance",
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
          <div className="bg-image min-h-svh min-w-0 overflow-x-hidden">
            <Header />
            <main className="min-w-0 pb-6 sm:pb-8">
              <Outlet />
            </main>
          </div>
          <ChatPopup />
        </WebSocketProvider>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
