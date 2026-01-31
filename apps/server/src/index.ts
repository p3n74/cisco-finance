// Handle uncaught errors FIRST, before any imports that might fail
process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

// Import env first to get PORT/HOST quickly
import { env } from "@cisco-finance/env/server";

console.log("Starting server initialization...");
console.log("Raw PORT from process.env:", process.env.PORT);
console.log("Environment:", {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  HOST: env.HOST,
  DATABASE_URL: env.DATABASE_URL ? "***configured***" : "missing",
});

// Start server immediately with minimal setup for Cloud Run health checks
import { createServer } from "node:http";
import express from "express";

const app = express();
const httpServer = createServer(app);

// Immediate health check endpoint (before any other initialization)
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

const port = env.PORT || 3000;
const host = env.HOST || "0.0.0.0";

console.log(`Starting HTTP server immediately on ${host}:${port}...`);

// Start listening IMMEDIATELY - this is critical for Cloud Run
httpServer.listen(port, host, () => {
  console.log(`✅ HTTP server is listening on http://${host}:${port}`);
  console.log("✅ Health check endpoint is available at /health");
});

// Handle server errors
httpServer.on("error", (error: Error) => {
  console.error("❌ Server error:", error);
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use`);
  }
  process.exit(1);
});

// Import path utilities (lightweight, safe to import)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Now dynamically import and initialize the rest of the application
// Using dynamic imports ensures the server is already listening before
// heavy modules (Prisma, auth, routers, etc.) are loaded
console.log("Initializing application modules (async)...");

(async () => {
  try {
    console.log("Loading application modules...");
    
    // Import all application modules dynamically
    // This ensures the server is already listening before heavy modules load
    const [
      { appRouter },
      { auth },
      { createExpressMiddleware },
      { toNodeHandler },
      corsModule,
      { createContext, setWsEmitter, setPresenceGetter },
      { emitToAll, emitToUser, getPresenceMap, initWebSocket },
    ] = await Promise.all([
      import("@cisco-finance/api/routers/index"),
      import("@cisco-finance/auth"),
      import("@trpc/server/adapters/express"),
      import("better-auth/node"),
      import("cors"),
      import("@cisco-finance/api/context"), // This will import db internally
      import("./websocket"),
    ]);

    const cors = corsModule.default;

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

    // Health check endpoint for WebSocket status
    app.get("/ws/health", (_req, res) => {
      res.status(200).json({ status: "ok", websocket: true });
    });

    console.log("✅ Application modules initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing application modules:", error);
    console.error("Stack:", (error as Error).stack);
    // Don't exit - server is already listening, just log the error
    // Health check endpoint will still work
  }
})();

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

// Server is already listening above, just log completion
console.log("✅ Server is ready to accept requests");

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
