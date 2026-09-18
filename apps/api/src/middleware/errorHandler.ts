import type { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Thrown when a claim would otherwise render without backing evidence. */
export class InsufficientEvidenceError extends ApiError {
  constructor(message = "Insufficient evidence to establish this claim.") {
    super(422, "INSUFFICIENT_EVIDENCE", message);
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = res.locals.requestId || req.header("x-request-id");

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, requestId } });
    return;
  }

  // Do not leak database, provider, or stack-trace details to public clients.
  console.error("Unhandled error", { requestId, method: req.method, path: req.path, error: err });
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong.", requestId },
  });
}
