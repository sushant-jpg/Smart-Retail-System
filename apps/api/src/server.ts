import { createServer } from "node:http";
import { Redis } from "ioredis";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { realtime, type RealtimeEvent } from "./lib/realtime.js";
import { startLoyaltyExpiryWorker } from "./services/loyalty-expiry.service.js";

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
const socketPub = redis.duplicate();
const socketSub = redis.duplicate();
await Promise.all([mongoose.connect(env.MONGODB_URI), redis.connect(), socketPub.connect(), socketSub.connect()]);

const app = createApp(redis);
const server = createServer(app);
const io = new Server(server, { cors: { origin: env.WEB_ORIGIN, credentials: true } });
io.adapter(createAdapter(socketPub, socketSub));
const stopLoyaltyExpiryWorker = startLoyaltyExpiryWorker();

io.use((socket, next) => {
  try {
    const raw = socket.handshake.auth.token;
    if (typeof raw !== "string") return next(new Error("AUTH_REQUIRED"));
    const payload = jwt.verify(raw, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { sub?: string; storeIds?: string[]; type?: string };
    if (payload.type !== "access" || !payload.sub) return next(new Error("TOKEN_INVALID"));
    socket.data.userId = payload.sub;
    socket.data.storeIds = payload.storeIds ?? [];
    next();
  } catch {
    next(new Error("TOKEN_INVALID"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${String(socket.data.userId)}`);
  for (const storeId of socket.data.storeIds as string[]) socket.join(`store:${storeId}`);
  socket.emit("connection.state", { state: "connected", at: new Date().toISOString() });
});

realtime.on("event", (event: RealtimeEvent) => {
  if (event.userId) io.to(`user:${event.userId}`).emit(event.name, event.payload);
  else if (event.room) io.to(event.room).emit(event.name, event.payload);
  else io.emit(event.name, event.payload);
});

const onListening = () => {
  console.log(JSON.stringify({ level: "info", event: "server.started", port: env.API_PORT, at: new Date().toISOString() }));
};
if (env.E2E_TEST_MODE) server.listen(env.API_PORT, "127.0.0.1", onListening);
else server.listen(env.API_PORT, onListening);

async function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "server.stopping", signal, at: new Date().toISOString() }));
  server.close();
  stopLoyaltyExpiryWorker();
  await Promise.allSettled([mongoose.disconnect(), socketPub.quit(), socketSub.quit(), redis.quit()]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
