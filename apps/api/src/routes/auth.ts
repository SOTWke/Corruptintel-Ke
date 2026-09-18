import { Router } from "express";
import { z } from "zod";
import { query } from "@corruptintel/database";
import { verifyPassword, signSessionToken } from "@corruptintel/security";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Intentionally no public /register route: researcher and admin accounts are
// provisioned by an existing ADMIN via the admin console (or the one-time
// seed-admin script), not via public self-signup. This platform deals with
// sensitive real-world allegations — account creation is not self-service.
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const result = await query<{
      id: string;
      email: string;
      password_hash: string | null;
      role: "PUBLIC" | "RESEARCHER" | "SENIOR_RESEARCHER" | "ADMIN";
      is_active: boolean;
    }>("SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1", [email]);

    const user = result.rows[0];
    if (!user || !user.is_active || !user.password_hash) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const token = signSessionToken({ sub: user.id, email: user.email, role: user.role });
    res.json({ data: { token, role: user.role, email: user.email } });
  } catch (err) {
    next(err);
  }
});

export default router;
