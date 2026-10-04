import { describe, expect, it } from "vitest";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess } from "./auth.js";

describe("store access enforcement", () => {
  it("rejects store-bound staff outside their assigned stores", () => {
    expect(() => assertStoreAccess({
      userId: "staff-1",
      role: "STORE_MANAGER",
      storeIds: ["store-1"],
    }, "store-2")).toThrowError(new AppError(403, "STORE_ACCESS_DENIED", "You do not have access to this store"));
  });

  it("allows staff assigned to the requested store", () => {
    expect(() => assertStoreAccess({
      userId: "cashier-1",
      role: "CASHIER",
      storeIds: ["store-1"],
    }, "store-1")).not.toThrow();
  });
});
