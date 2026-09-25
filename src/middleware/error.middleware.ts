import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";
import { sendError } from "../helpers/response.helper";
import { CONSTANTS, HTTP_STATUS } from "../config/constants";
import type { MulterError } from "multer";

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error(err.message, {
    stack: err.stack,
    url: req.url,
    method: req.method,
  });
  if (err instanceof AppError) {
    sendError(res, err.message, err.statusCode);
    return;
  }
  if (err.name === "ValidationError") {
    sendError(res, err.message, HTTP_STATUS.BAD_REQUEST);
    return;
  }
  if (err.name === "CastError") {
    sendError(res, "Invalid ID format", HTTP_STATUS.BAD_REQUEST);
    return;
  }
  // Multer rejects an oversized file, a surplus file or an unexpected field name by throwing.
  // Without this every upload route answered 500 — a server error for a client mistake, which
  // tells a client to retry when it should fix the request.
  if (err.name === "MulterError") {
    const { code, field } = err as MulterError;
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: `File must be ${CONSTANTS.MAX_FILE_SIZE / (1024 * 1024)}MB or smaller`,
      LIMIT_FILE_COUNT: "Too many files uploaded",
      LIMIT_UNEXPECTED_FILE: `Unexpected file field${field ? ` "${field}"` : ""}`,
    };
    sendError(res, messages[code] ?? err.message, HTTP_STATUS.BAD_REQUEST);
    return;
  }
  sendError(res, "Internal server error", HTTP_STATUS.INTERNAL_SERVER);
};

export const notFound = (req: Request, res: Response): void => {
  sendError(
    res,
    `Route ${req.method} ${req.url} not found`,
    HTTP_STATUS.NOT_FOUND
  );
};