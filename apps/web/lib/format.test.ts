import { describe, expect, it } from "vitest";
import { cn, money } from "./format";

describe("presentation helpers", () => {
  it("formats integer minor units as Nepalese rupees", () => {
    expect(money(450075)).toContain("4,500.75");
  });

  it("joins only active class names", () => {
    expect(cn("card", false, undefined, "active")).toBe("card active");
  });
});
