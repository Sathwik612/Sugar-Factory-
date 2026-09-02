import crypto from "node:crypto";
import type { AuthUser } from "@workspace/api-zod";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type CookieOptions, type Request, type Response } from "express";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function envBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

export function sessionCookieOptions(): CookieOptions {
  const sameSite = process.env.COOKIE_SAME_SITE === "strict" || process.env.COOKIE_SAME_SITE === "none"
    ? process.env.COOKIE_SAME_SITE
    : "lax";
  return {
    httpOnly: true,
    secure: envBoolean(process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
    sameSite,
    path: "/",
    maxAge: SESSION_TTL,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

export interface SessionData {
  user: AuthUser;
  created_at: number;
}

export interface LocalUserRecord {
  id: string;
  username: string | null;
  email: string | null;
  passwordHash: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string | null;
  department: string | null;
  isDemo: boolean;
}

export function toAuthUser(user: LocalUserRecord): AuthUser {
  return {
    id: user.id,
    username: user.username ?? user.email ?? user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    role: (user.role ?? "MANAGER") as AuthUser["role"],
    department: user.department ?? "MANAGEMENT",
    isDemo: user.isDemo,
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const [algorithm, salt, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;

  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  const { maxAge: _maxAge, ...options } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, options);
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return req.cookies?.[SESSION_COOKIE];
}