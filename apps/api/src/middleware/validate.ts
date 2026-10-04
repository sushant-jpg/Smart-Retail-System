import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../lib/app-error.js";

export const validate = (schema: ZodType, source: "body" | "query" | "params" = "body") =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError(422, "VALIDATION_FAILED", "Request validation failed", result.error.flatten()));
    }
    if (source === "query") {
      Object.defineProperty(req, "query", { configurable: true, enumerable: true, writable: true, value: result.data });
    } else {
      req[source] = result.data;
    }
    next();
  };
