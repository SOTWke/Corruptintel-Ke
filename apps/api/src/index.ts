import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { attachUser } from "@corruptintel/security";
import { errorHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/auth";
import casesRoutes from "./routes/cases";
import statisticsRoutes from "./routes/statistics";
import adminRoutes from "./routes/admin";
import researchRoutes from "./routes/research";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(attachUser);

// Public endpoints: generous limit. /research is LLM-backed and costlier —
// tighter limit, per Security Architecture §4.
const publicLimiter = rateLimit({ windowMs: 60_000, max: 120 });
const researchLimiter = rateLimit({ windowMs: 60_000, max: 10 });
app.use(publicLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "corruptintel-api", time: new Date().toISOString() });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/cases", casesRoutes);
app.use("/api/v1/statistics", statisticsRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/research", researchLimiter, researchRoutes);

app.use(errorHandler);

const port = Number(process.env.API_PORT) || 4000;
app.listen(port, () => {
  console.log(`CorruptIntel API listening on :${port}`);
});
