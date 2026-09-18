import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@corruptintel/shared";
import { verifySessionToken, SessionTokenPayload } from "./auth";

// Role hierarchy: each role includes everything below it.
const ROLE_RANK: Record<UserRole, number> = {
  PUBLIC: 0,
  RESEARCHER: 1,
  SENIOR_RESEARCHER: 2,
  ADMIN: 3,
};

export interface AuthedRequest extends Request {
  user?: SessionTokenPayload;
}

/** Reads the Bearer token if present and attaches req.user. Does NOT reject
 * requests with no token — public endpoints need to keep working. Use
 * `requireRole` on top of this for anything that needs a logged-in user. */
export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = verifySessionToken(header.slice("Bearer ".length));
    } catch {
      // invalid/expired token — treat as anonymous rather than erroring here;
      // requireRole below will reject if the route actually needs auth.
    }
  }
  next();
}

/** Rejects the request unless req.user's role is at least `minRole`. This is
 * the single enforcement point for RBAC — routes should never re-implement
 * role checks inline (Security Architecture §1). */
export function requireRole(minRole: UserRole) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required." } });
      return;
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      res.status(403).json({
        error: { code: "FORBIDDEN", message: `Requires ${minRole} role or above.` },
      });
      return;
    }
    next();
  };
}
