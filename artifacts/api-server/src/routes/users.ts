import {
  CreateUserBody,
  ListUsersResponse,
  ResetUserPasswordBody,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { Router, type IRouter } from "express";

import { recordAudit } from "../lib/audit";
import { hashPassword } from "../lib/auth";
import { isRole, requireRoles } from "../lib/authz";

const router: IRouter = Router();

function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username ?? user.id,
    email: user.email ?? "",
    role: user.role ?? "MANAGER",
    department: user.department ?? "MANAGEMENT",
    isDemo: user.isDemo,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users", requireRoles("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
    res.json(ListUsersResponse.parse(rows.map(publicUser)));
  } catch (error) {
    next(error);
  }
});

router.post("/users", requireRoles("ADMIN"), async (req, res, next) => {
  try {
    const body = CreateUserBody.parse(req.body);
    const username = body.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !isRole(body.role)) {
      res.status(400).json({ error: "Use a valid username and one of the supported roles." });
      return;
    }
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    const [created] = await db
      .insert(usersTable)
      .values({
        username,
        email: `${username}@demo.local`,
        passwordHash: hashPassword(body.password),
        firstName: username,
        role: body.role,
        department: body.department.trim().toUpperCase(),
        isDemo: false,
      })
      .returning();
    await recordAudit(req, "CREATED_USER", "user", created.id, {
      username,
      role: body.role,
      department: body.department,
    });
    res.status(201).json(publicUser(created));
  } catch (error) {
    next(error);
  }
});

router.post("/users/:userId/reset-password", requireRoles("ADMIN"), async (req, res, next) => {
  try {
    const body = ResetUserPasswordBody.parse(req.body);
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash: hashPassword(body.password), updatedAt: new Date() })
      .where(eq(usersTable.id, String(req.params.userId)))
      .returning({ id: usersTable.id });
    if (!updated) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    await recordAudit(req, "RESET_USER_PASSWORD", "user", updated.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;