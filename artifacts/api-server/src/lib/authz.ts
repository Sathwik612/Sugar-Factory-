import type { AuthUser } from "@workspace/api-zod";
import type { NextFunction, Request, Response } from "express";

export const ROLES = [
  "PRODUCTION_OPERATOR",
  "QUALITY_OPERATOR",
  "ENGINEERING_OPERATOR",
  "STORES_OPERATOR",
  "MANAGER",
  "ADMIN",
] as const;

export type Role = (typeof ROLES)[number];
export type OperationalSection =
  | "production"
  | "quality"
  | "engineering"
  | "stores";

const sectionRoles: Record<OperationalSection, readonly Role[]> = {
  production: ["PRODUCTION_OPERATOR", "MANAGER", "ADMIN"],
  quality: ["QUALITY_OPERATOR", "MANAGER", "ADMIN"],
  engineering: ["ENGINEERING_OPERATOR", "MANAGER", "ADMIN"],
  stores: ["STORES_OPERATOR", "MANAGER", "ADMIN"],
};

export function isRole(value: string | null | undefined): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value);
}

export function canEditSection(
  user: Pick<AuthUser, "role"> | null | undefined,
  section: OperationalSection,
): boolean {
  return !!user && sectionRoles[section].includes(user.role as Role);
}

export function canReview(user: Pick<AuthUser, "role"> | null | undefined): boolean {
  return user?.role === "MANAGER" || user?.role === "ADMIN";
}

export function canAdminister(user: Pick<AuthUser, "role"> | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({ error: "This role does not have access to this module." });
      return;
    }
    next();
  };
}