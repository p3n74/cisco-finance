import { createServer } from "node:http";
import { appRouter } from "@cisco-finance/api/routers/index";
import { auth } from "@cisco-finance/auth";
import { env } from "@cisco-finance/env/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { toNodeHandler } from "better-auth/node";
import compression from "compression";
import cors from "cors";
import express from "express";
import { createContext, setWsEmitter, setPresenceGetter } from "@cisco-finance/api/context";
import { emitToAll, emitToUser, getPresenceMap, initWebSocket } from "./websocket";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Compress responses (gzip) for faster transfer
app.use(compression());

// Initialize WebSocket server
initWebSocket(httpServer, env.CORS_ORIGIN);

// Wire up WebSocket emitter and presence getter to API context
setWsEmitter({
  emitToUser: (userId, payload) => emitToUser(userId, payload),
  emitToAll: (payload) => emitToAll(payload),
});
setPresenceGetter(() => getPresenceMap());

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.all("/api/auth", toNodeHandler(auth));
app.all("/api/auth/*path", toNodeHandler(auth));

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.use(express.json());

// Health check (for load balancers / monitoring)
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// Health check endpoint for WebSocket status
app.get("/ws/health", (_req, res) => {
  res.status(200).json({ status: "ok", websocket: true });
});

// Serve static files from the web app (cache hashed assets 1 year, index.html no store)
const webDistPath = path.resolve(__dirname, "../../web/dist");
app.use(
  express.static(webDistPath, {
    maxAge: "1y",
    immutable: true,
    setHeaders: (res, filePath) => {
      // Don't cache index.html so clients get updates
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  }),
);

// Fallback to index.html for SPA routing
app.get("/*path", (req, res, next) => {
  // Don't intercept TRPC or Auth routes
  if (req.path.startsWith("/trpc") || req.path.startsWith("/api/auth")) {
    return next();
  }
  res.sendFile(path.join(webDistPath, "index.html"));
});

const port = env.PORT;
httpServer.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log("WebSocket server is ready for connections");
});
