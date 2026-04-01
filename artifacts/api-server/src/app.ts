import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { csrfMiddleware } from "./middleware/auth";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://mail.zayvex.cloud", "wss:", "ws:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  xContentTypeOptions: true,
  xFrameOptions: { action: "deny" },
  xXssProtection: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
}));

app.use(compression());

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => (req as Request).url === "/api/healthz",
    },
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

const ALLOWED_ORIGINS = process.env["CORS_ORIGINS"]
  ? process.env["CORS_ORIGINS"].split(",").map((s) => s.trim())
  : [];

app.use(
  cors({
    origin:
      ALLOWED_ORIGINS.length > 0
        ? ALLOWED_ORIGINS
        : process.env["NODE_ENV"] === "production"
          ? false
          : true,
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  skip: (req) => req.path === "/api/healthz",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later" },
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin login attempts. Try again later." },
});
app.use("/api/auth/admin-login", adminAuthLimiter);

const CSRF_EXEMPT = ["/auth/login", "/auth/admin-login", "/auth/logout", "/healthz", "/incoming-mail"];
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (CSRF_EXEMPT.some((p) => req.path === p || req.path.startsWith(p))) {
    next();
    return;
  }
  csrfMiddleware(req, res, next);
});

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
