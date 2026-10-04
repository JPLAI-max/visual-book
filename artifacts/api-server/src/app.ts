import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { ZodError } from "zod/v4";

const app: Express = express();

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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use("/api/admin/intelligence",express.json({limit:"3mb"}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
})));
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    const origin = new URL(req.headers.origin).host;
    const host = getClerkProxyHost(req) ?? req.headers.host;
    if (origin !== host) { res.status(403).json({ error: "Cross-origin writes are not allowed" }); return; }
  }
  next();
});

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) { res.status(400).json({ error: "Invalid input", details: err.issues }); return; }
  const error = err as Error & { status?: number };
  if (error.status) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ err }, "Request failed");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
});

export default app;
