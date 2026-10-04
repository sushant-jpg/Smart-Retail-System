import { describe, expect, it } from "vitest";
import { can, canGrantRole, canManageUserRole } from "./permissions.js";

describe("role permissions", () => {
  it("allows customers to create sales but not adjust inventory", () => {
    expect(can("CUSTOMER", "sale.create")).toBe(true);
    expect(can("CUSTOMER", "inventory.adjust")).toBe(false);
  });

  it("restricts security management to super admins", () => {
    expect(can("ADMIN", "security.manage")).toBe(false);
    expect(can("SUPER_ADMIN", "security.manage")).toBe(true);
  });

  it("prevents administrators from creating or modifying super-administrator access", () => {
    expect(canManageUserRole("ADMIN", "STORE_MANAGER", "SUPER_ADMIN")).toBe(false);
    expect(canManageUserRole("ADMIN", "SUPER_ADMIN", "STORE_MANAGER")).toBe(false);
    expect(canManageUserRole("SUPER_ADMIN", "STORE_MANAGER", "SUPER_ADMIN")).toBe(true);
  });

  it("does not let an administrator grant another user administrator privileges", () => {
    expect(canGrantRole("ADMIN", "ADMIN")).toBe(false);
    expect(canGrantRole("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(canManageUserRole("ADMIN", "STORE_MANAGER", "ADMIN")).toBe(false);
    expect(canManageUserRole("ADMIN", "ADMIN", "ADMIN")).toBe(true);
  });
});
