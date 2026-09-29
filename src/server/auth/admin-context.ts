import "server-only";
import { redirect } from "next/navigation";
import type { Permission } from "./permissions";
import { organizationsWith, requireAuth } from "./session";

/** Page guard for /admin: the user must hold `permission` in at least one organization. */
export async function adminContext(permission: Permission) {
  const auth = await requireAuth();
  const orgs = await organizationsWith(auth, permission);
  if (orgs.length === 0) {
    // Operators without admin rights land on the scanner instead of an error page.
    if (auth.memberships.length > 0 && auth.memberships.every((m) => m.role === "PROMOTER")) redirect("/promoter");
    redirect(permission === "dashboard:view" ? "/checkin" : "/admin");
  }
  return { auth, orgs, orgIds: orgs.map((o) => o.organizationId) };
}
