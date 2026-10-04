export const roles = [
  "CUSTOMER",
  "CASHIER",
  "STORE_STAFF",
  "STORE_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "product.read", "product.create", "product.update", "product.delete",
  "inventory.read", "inventory.adjust", "sale.create", "sale.refund",
  "supplier.manage", "employee.manage", "promotion.manage", "analytics.read",
  "store.manage", "audit.read", "security.manage", "category.manage",
  "purchase.manage", "refund.approve", "loyalty.manage", "notification.read", "user.manage",
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  CUSTOMER: new Set(["product.read", "sale.create", "sale.refund", "notification.read"]),
  CASHIER: new Set(["product.read", "inventory.read", "sale.create", "sale.refund", "notification.read"]),
  STORE_STAFF: new Set(["product.read", "product.update", "inventory.read", "inventory.adjust", "notification.read"]),
  STORE_MANAGER: new Set([
    "product.read", "product.create", "product.update", "inventory.read", "inventory.adjust",
    "sale.create", "sale.refund", "supplier.manage", "employee.manage", "promotion.manage", "analytics.read",
    "category.manage", "purchase.manage", "refund.approve", "loyalty.manage", "notification.read",
  ]),
  ADMIN: new Set(permissions.filter((permission) => permission !== "security.manage")),
  SUPER_ADMIN: new Set(permissions),
};

export const can = (role: Role, permission: Permission) => rolePermissions[role].has(permission);

export function canGrantRole(actorRole: Role, targetRole: Role) {
  if (actorRole === "SUPER_ADMIN") return true;
  return targetRole !== "SUPER_ADMIN" && !(actorRole === "ADMIN" && targetRole === "ADMIN");
}

export function canManageUserRole(actorRole: Role, currentRole: Role, nextRole?: Role) {
  if (actorRole === "SUPER_ADMIN") return true;
  if (currentRole === "SUPER_ADMIN" || nextRole === "SUPER_ADMIN") return false;
  return !(actorRole === "ADMIN" && nextRole === "ADMIN" && currentRole !== "ADMIN");
}
