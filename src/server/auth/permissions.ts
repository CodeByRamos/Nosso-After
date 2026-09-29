/**
 * RBAC matrix (ADR-0005). Membership roles are scoped to one organization;
 * SUPER_ADMIN is a platform role that implies every permission in every organization.
 */
export type MembershipRole = "ORGANIZATION_ADMIN" | "EVENT_MANAGER" | "CHECKIN_OPERATOR" | "PROMOTER";

export type Permission =
  | "dashboard:view"
  | "events:read"
  | "events:write"
  | "orders:read"
  | "sales:read" // ticket counts, no money
  | "finance:read" // revenue, fees, payments
  | "refunds:create"
  | "reconciliation:manage"
  | "privacy:manage" // LGPD data-subject requests
  | "tickets:read"
  | "tickets:write"
  | "checkin:perform"
  | "checkin:read"
  | "members:manage"
  | "fees:manage" // platform-only: producers cannot change the platform's own fee
  | "platform:admin";

const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  ORGANIZATION_ADMIN: [
    "dashboard:view",
    "events:read",
    "events:write",
    "orders:read",
    "sales:read",
    "finance:read",
    "refunds:create",
    "reconciliation:manage",
    "privacy:manage",
    "tickets:read",
    "tickets:write",
    "checkin:perform",
    "checkin:read",
    "members:manage",
  ],
  EVENT_MANAGER: [
    "dashboard:view",
    "events:read",
    "events:write",
    "orders:read",
    "sales:read",
    "tickets:read",
    "checkin:perform",
    "checkin:read",
  ],
  CHECKIN_OPERATOR: ["checkin:perform"],
  PROMOTER: [],
};

export function roleHas(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: MembershipRole | "SUPER_ADMIN"): readonly Permission[] {
  if (role === "SUPER_ADMIN") {
    return [...new Set([...ROLE_PERMISSIONS.ORGANIZATION_ADMIN, "fees:manage", "platform:admin"] as Permission[])];
  }
  return ROLE_PERMISSIONS[role];
}
