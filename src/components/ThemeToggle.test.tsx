import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeToggle from "./ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle", () => {
  it("defaults to system when nothing is stored", async () => {
    render(<ThemeToggle />);

    const system = screen.getByRole("button", { name: "System" });
    await screen.findByTestId("theme-toggle");
    expect(system).toHaveAttribute("aria-pressed", "true");
  });

  it("initializes from the stored preference", async () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);

    const dark = screen.getByRole("button", { name: "Dark" });
    await screen.findByTestId("theme-toggle");
    expect(dark).toHaveAttribute("aria-pressed", "true");
  });

  it("selecting Dark applies the class and persists", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("selecting Light removes the dark class", async () => {
    const user = userEvent.setup();
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("selecting System follows the (light) OS preference", async () => {
    const user = userEvent.setup();
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "System" }));

    // setup stubs matchMedia to matches: false → light
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("system");
  });
});
