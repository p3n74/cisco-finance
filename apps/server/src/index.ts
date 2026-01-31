import { createServer } from "node:http";
import { appRouter } from "@cisco-finance/api/routers/index";
import { auth } from "@cisco-finance/auth";
import { env } from "@cisco-finance/env/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { createContext, setWsEmitter, setPresenceGetter } from "@cisco-finance/api/context";
import { emitToAll, emitToUser, getPresenceMap, initWebSocket } from "./websocket";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

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

// Serve static files from the web app (if it exists)
const webDistPath = path.resolve(__dirname, "../../web/dist");
if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  
  // Fallback to index.html for SPA routing
  app.get("/*path", (req, res, next) => {
    // Don't intercept TRPC or Auth routes
    if (req.path.startsWith("/trpc") || req.path.startsWith("/api/auth")) {
      return next();
    }
    const indexPath = path.join(webDistPath, "index.html");
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
} else {
  console.warn(`Web dist path not found: ${webDistPath}. Static file serving disabled.`);
}

const port = env.PORT || 3000;
const host = env.HOST || "0.0.0.0"; // Default to 0.0.0.0 for Cloud Run compatibility

httpServer.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
  console.log("WebSocket server is ready for connections");
});

// Handle server errors
httpServer.on("error", (error: Error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
