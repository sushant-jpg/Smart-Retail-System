import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { Redis } from "ioredis";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { requestContext } from "./middleware/request-context.js";
import { openApiDocument } from "./openapi.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import authRoutes from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import inventoryRoutes from "./routes/inventory.routes.js";
import productRoutes from "./routes/product.routes.js";
import saleRoutes from "./routes/sale.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import loyaltyRoutes from "./routes/loyalty.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import promotionRoutes from "./routes/promotion.routes.js";
import purchaseOrderRoutes from "./routes/purchase-order.routes.js";
import receiptRoutes from "./routes/receipt.routes.js";
import refundRoutes from "./routes/refund.routes.js";
import storeRoutes from "./routes/store.routes.js";
import supplierRoutes from "./routes/supplier.routes.js";
import searchRoutes from "./routes/search.routes.js";
import intelligenceRoutes from "./routes/intelligence.routes.js";
import customerRoutes from "./routes/customer.routes.js";

export function createApp(redis: Redis) {
  const app = express();
  app.disable("x-powered-by");
  if (env.E2E_TEST_MODE) app.set("trust proxy", true);
  app.use(requestContext);
  app.use(pinoHttp({
    redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.token"],
    customProps: (req) => ({ requestId: req.requestId }),
  }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/health", healthRouter(redis));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use("/api/v1/auth", authRoutes(redis));
  app.use("/api/v1/customers", customerRoutes);
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/products", productRoutes);
  app.use("/api/v1/categories", categoryRoutes);
  app.use("/api/v1/inventory", inventoryRoutes);
  app.use("/api/v1/stores", storeRoutes);
  app.use("/api/v1/suppliers", supplierRoutes);
  app.use("/api/v1/purchase-orders", purchaseOrderRoutes);
  app.use("/api/v1/sales", saleRoutes);
  app.use("/api/v1/refunds", refundRoutes);
  app.use("/api/v1/receipts", receiptRoutes);
  app.use("/api/v1/promotions", promotionRoutes);
  app.use("/api/v1/loyalty", loyaltyRoutes);
  app.use("/api/v1/notifications", notificationRoutes);
  app.use("/api/v1/search", searchRoutes);
  app.use("/api/v1/intelligence", intelligenceRoutes);
  app.use("/api/v1/analytics", analyticsRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
