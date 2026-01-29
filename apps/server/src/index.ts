import { createServer } from "node:http";
import { createContext, setWsEmitter } from "@cisco-finance/api/context";
import { appRouter } from "@cisco-finance/api/routers/index";
import { auth } from "@cisco-finance/auth";
import { env } from "@cisco-finance/env/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { emitToAll, emitToUser, initWebSocket } from "./websocket";

const app = express();
const httpServer = createServer(app);

// Initialize WebSocket server
initWebSocket(httpServer, env.CORS_ORIGIN);

// Wire up WebSocket emitter to API context
setWsEmitter({
  emitToUser: (userId, payload) => emitToUser(userId, payload),
  emitToAll: (payload) => emitToAll(payload),
});

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.all("/api/auth{/*path}", toNodeHandler(auth));

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

// Health check endpoint for WebSocket status
app.get("/ws/health", (_req, res) => {
  res.status(200).json({ status: "ok", websocket: true });
});

httpServer.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
  console.log("WebSocket server is ready for connections");
});
