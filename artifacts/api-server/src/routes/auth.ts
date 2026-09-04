import {
  GetCurrentAuthUserResponse,
  LoginWithDemoCredentialsBody,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";

import {
  clearSession,
  createSession,
  getSessionId,
  hashPassword,
  sessionCookieOptions,
  toAuthUser,
  verifyPassword,
  type SessionData,
} from "../lib/auth";

const router: IRouter = Router();

const demoAccounts = [
  {
    username: "production",
    role: "PRODUCTION_OPERATOR",
    department: "PRODUCTION",
    firstName: "Production",
    lastName: "Operator",
  },
  {
    username: "quality",
    role: "QUALITY_OPERATOR",
    department: "QUALITY",
    firstName: "Quality",
    lastName: "Operator",
  },
  {
    username: "engineering",
    role: "ENGINEERING_OPERATOR",
    department: "ENGINEERING",
    firstName: "Engineering",
    lastName: "Operator",
  },
  {
    username: "stores",
    role: "STORES_OPERATOR",
    department: "STORES",
    firstName: "Stores",
    lastName: "Operator",
  },
  {
    username: "manager",
    role: "MANAGER",
    department: "MANAGEMENT",
    firstName: "Factory",
    lastName: "Manager",
  },
  {
    username: "admin",
    role: "ADMIN",
    department: "ADMINISTRATION",
    firstName: "System",
    lastName: "Administrator",
  },
] as const;

export async function seedDemoUsers() {
  for (const account of demoAccounts) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, account.username))
      .limit(1);

    if (existing.length) {
      await db
        .update(usersTable)
        .set({
          email: `${account.username}@demo.local`,
          firstName: account.firstName,
          lastName: account.lastName,
          role: account.role,
          department: account.department,
          isDemo: true,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existing[0].id));
      continue;
    }

    await db.insert(usersTable).values({
      username: account.username,
      email: `${account.username}@demo.local`,
      passwordHash: hashPassword("demo123"),
      firstName: account.firstName,
      lastName: account.lastName,
      role: account.role,
      department: account.department,
      isDemo: true,
    });
  }
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie("sid", sid, sessionCookieOptions());
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.post("/login", async (req: Request, res: Response, next) => {
  try {
    const { username, password } = LoginWithDemoCredentialsBody.parse(req.body);
    const normalizedUsername = username.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, normalizedUsername))
      .limit(1);

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }

    if (!verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }

    const authUser = toAuthUser(user);
    const sessionData: SessionData = {
      user: authUser,
      created_at: Math.floor(Date.now() / 1000),
    };
    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);
    res.json({ user: authUser });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req: Request, res: Response, next) => {
  try {
    await clearSession(res, getSessionId(req));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export { demoAccounts };
export default router;