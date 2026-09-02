import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { apiRateLimiter, loginRateLimiter } from "./middlewares/rateLimit";

const app: Express = express();
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
const configuredOrigins = new Set(
  (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use(cors((req, callback) => {
  const origin = req.header("Origin");
  if (!origin) {
    callback(null, { origin: false });
    return;
  }
  let sameOrigin = false;
  try {
    sameOrigin = new URL(origin).host === req.get("host");
  } catch {
    sameOrigin = false;
  }
  callback(null, {
    credentials: true,
    origin: sameOrigin || configuredOrigins.has(origin) ? origin : false,
  });
}));
app.use(cookieParser());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "1mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT ?? "256kb" }));
app.use("/api/login", loginRateLimiter);
app.use("/api", (req, res, next) => {
  if (req.path === "/healthz" || req.path === "/readyz") {
    next();
    return;
  }
  apiRateLimiter(req, res, next);
});
app.use(authMiddleware);

app.use("/api", router);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." });
});

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  req.log?.error({ err: error, requestId: req.id }, "Request failed");
  if (res.headersSent) return;
  const validationError = error && typeof error === "object" && "issues" in error;
  res.status(validationError ? 400 : 500).json({
    error: validationError ? "Validation failed." : "Internal server error.",
    requestId: req.id,
  });
};
app.use(errorHandler);

export default app;
