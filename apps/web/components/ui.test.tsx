// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductVisual } from "./ui";

afterEach(cleanup);

describe("ProductVisual", () => {
  it("renders the provided product image instead of initials", () => {
    render(<ProductVisual initials="OM" image="/products/oat-milk-barista.svg" alt="Oat Milk Barista" accent="" />);
    expect(screen.getByRole("img", { name: "Oat Milk Barista" })).toHaveAttribute("src", "/products/oat-milk-barista.svg");
    expect(screen.queryByText("OM")).not.toBeInTheDocument();
  });

  it("uses initials only after an image fails to load", () => {
    render(<ProductVisual initials="OM" image="/products/missing.svg" alt="Oat Milk Barista" accent="" />);
    fireEvent.error(screen.getByRole("img", { name: "Oat Milk Barista" }));
    expect(screen.getByText("OM")).toBeInTheDocument();
  });
});
