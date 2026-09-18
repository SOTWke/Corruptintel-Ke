import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { UserRole } from "@corruptintel/shared";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SessionTokenPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  const expiresIn = process.env.JWT_EXPIRY || "8h";
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.verify(token, secret) as SessionTokenPayload;
}
