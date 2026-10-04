import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../lib/app-error.js";
import { SecurityEvent } from "../models/security-event.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = async (error, req, res, _next) => {
  const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === 11000;
  const mongooseValidation = typeof error === "object" && error !== null && "name" in error && error.name === "ValidationError";
  const castError = typeof error === "object" && error !== null && "name" in error && error.name === "CastError";
  const invalidJson = error instanceof SyntaxError && "status" in error && error.status === 400;
  const known = error instanceof AppError;
  const status = known ? error.status : duplicate ? 409 : mongooseValidation || castError ? 422 : invalidJson ? 400 : 500;
  const code = known ? error.code : duplicate ? "RESOURCE_CONFLICT" : mongooseValidation ? "MODEL_VALIDATION_FAILED" : castError ? "INVALID_ID" : invalidJson ? "INVALID_JSON" : "INTERNAL_ERROR";
  const message = known ? error.message : duplicate ? "A resource with this unique value already exists" : mongooseValidation ? "Stored data validation failed" : castError ? "An identifier is invalid" : invalidJson ? "Request body contains invalid JSON" : "An unexpected error occurred";

  if (!known) req.log?.error({ err: error, requestId: req.requestId }, "Unhandled request error");
  if (known && (error.code === "PERMISSION_DENIED" || error.code === "STORE_ACCESS_DENIED")) {
    try {
      await SecurityEvent.create({
        type: "PERMISSION_DENIED",
        severity: "MEDIUM",
        user: req.auth?.userId,
        ip: req.ip,
        userAgent: req.get("user-agent"),
        metadata: { route: req.route?.path ?? req.path, method: req.method, code: error.code },
      });
    } catch (securityLogError) {
      req.log?.error({ err: securityLogError, requestId: req.requestId }, "Failed to record authorization security event");
    }
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(known && error.details ? { details: error.details } : {}),
      requestId: req.requestId,
    },
  });
};
