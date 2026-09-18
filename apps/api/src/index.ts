import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { attachUser } from "@corruptintel/security";
import { errorHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/auth";
import casesRoutes from "./routes/cases";
import statisticsRoutes from "./routes/statistics";
import adminRoutes from "./routes/admin";
import researchRoutes from "./routes/research";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Render correct client IPs when the API is behind a trusted load balancer.
if (isProduction) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin and non-browser requests do not send an Origin header.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb", strict: true }));
app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  res.locals.requestId = requestId;
  next();
});
app.use(attachUser);

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." } },
});
const researchLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Research query limit reached. Try again shortly." } },
});
app.use(publicLimiter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "corruptintel-api", time: new Date().toISOString() });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/cases", casesRoutes);
app.use("/api/v1/statistics", statisticsRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/research", researchLimiter, researchRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
});
app.use(errorHandler);

const port = Number(process.env.API_PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`CorruptIntel API listening on :${port}`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received; stopping API server`);
  server.close((error) => {
    if (error) {
      console.error("Failed to close API server cleanly:", error);
      process.exitCode = 1;
    }
    process.exit();
  });
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

export { app };
