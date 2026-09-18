import type { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Thrown by the evidence-serialization layer when a claim would otherwise
 * render with no backing evidence. This should never fire in normal
 * operation — the schema's NOT NULL evidence_id constraints make the
 * underlying condition close to impossible — but if it ever does, the
 * correct behavior is to refuse to answer, not to render an unsourced claim. */
export class InsufficientEvidenceError extends ApiError {
  constructor(message = "Insufficient evidence to establish this claim.") {
    super(422, "INSUFFICIENT_EVIDENCE", message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
}
