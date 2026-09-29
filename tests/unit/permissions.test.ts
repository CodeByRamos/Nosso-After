import { describe, expect, it } from "vitest";
import { permissionsFor, roleHas } from "@/server/auth/permissions";

describe("RBAC matrix", () => {
  it("check-in operators cannot see money or orders", () => {
    for (const p of ["finance:read", "orders:read", "refunds:create", "dashboard:view", "events:write"] as const) {
      expect(roleHas("CHECKIN_OPERATOR", p)).toBe(false);
    }
    expect(roleHas("CHECKIN_OPERATOR", "checkin:perform")).toBe(true);
  });
  it("event managers operate events but cannot refund or read finance", () => {
    expect(roleHas("EVENT_MANAGER", "events:write")).toBe(true);
    expect(roleHas("EVENT_MANAGER", "finance:read")).toBe(false);
    expect(roleHas("EVENT_MANAGER", "refunds:create")).toBe(false);
  });
  it("only the platform manages platform fees", () => {
    expect(roleHas("ORGANIZATION_ADMIN", "fees:manage")).toBe(false);
    expect(permissionsFor("SUPER_ADMIN")).toContain("fees:manage");
  });
  it("promoters get no admin permissions yet", () => {
    expect(permissionsFor("PROMOTER")).toHaveLength(0);
  });
});
