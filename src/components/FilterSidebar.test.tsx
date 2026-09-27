import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FilterSidebar, {
  EMPTY_FILTERS,
  appendFilterParams,
  isEmptyFilters,
  type OrderFilters,
} from "./FilterSidebar";

const ACTIVE: OrderFilters = {
  status: ["PENDING", "SHIPPED"],
  regionCodes: ["US-E"],
  from: "2026-01-01",
  to: "2026-01-31",
  totalMin: "5",
  totalMax: "500",
};

describe("appendFilterParams", () => {
  it("adds nothing for empty or missing filters", () => {
    const params = new URLSearchParams();
    appendFilterParams(params, undefined);
    appendFilterParams(params, EMPTY_FILTERS);
    expect(params.toString()).toBe("");
  });

  it("maps every filter to its backend parameter name", () => {
    const params = new URLSearchParams();
    appendFilterParams(params, ACTIVE);
    expect(params.get("status")).toBe("PENDING,SHIPPED");
    expect(params.get("regionCode")).toBe("US-E");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-01-31");
    expect(params.get("minTotal")).toBe("5");
    expect(params.get("maxTotal")).toBe("500");
  });
});

describe("isEmptyFilters", () => {
  it("detects empty and non-empty filters", () => {
    expect(isEmptyFilters(EMPTY_FILTERS)).toBe(true);
    expect(isEmptyFilters({ ...EMPTY_FILTERS, status: ["PENDING"] })).toBe(false);
    expect(isEmptyFilters({ ...EMPTY_FILTERS, from: "2026-01-01" })).toBe(false);
    expect(isEmptyFilters({ ...EMPTY_FILTERS, totalMax: "9" })).toBe(false);
  });
});

describe("FilterSidebar", () => {
  const regions = [
    { code: "US-E", name: "US East" },
    { code: "EU-W", name: "EU West" },
  ];

  it("toggles a status via the combobox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterSidebar value={EMPTY_FILTERS} onChange={onChange} regionOptions={regions} />,
    );

    await user.click(screen.getByTestId("filter-status-search"));
    await user.click(screen.getByTestId("filter-status-SHIPPED"));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, status: ["SHIPPED"] });
  });

  it("removes an already-selected status", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value = { ...EMPTY_FILTERS, status: ["SHIPPED"] };
    render(<FilterSidebar value={value} onChange={onChange} regionOptions={regions} />);

    await user.click(screen.getByRole("button", { name: "Remove SHIPPED" }));

    expect(onChange).toHaveBeenCalledWith({ ...value, status: [] });
  });

  it("filters combobox options by search text and toggles a region", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterSidebar value={EMPTY_FILTERS} onChange={onChange} regionOptions={regions} />,
    );

    await user.type(screen.getByTestId("filter-region-search"), "east");
    expect(screen.queryByTestId("filter-region-EU-W")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("filter-region-US-E"));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, regionCodes: ["US-E"] });
  });

  it("shows 'No matches.' when the search matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <FilterSidebar value={EMPTY_FILTERS} onChange={vi.fn()} regionOptions={regions} />,
    );

    await user.type(screen.getByTestId("filter-status-search"), "zzz");

    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("shows the empty text when no regions are loaded", async () => {
    const user = userEvent.setup();
    render(
      <FilterSidebar value={EMPTY_FILTERS} onChange={vi.fn()} regionOptions={[]} />,
    );

    await user.click(screen.getByTestId("filter-region-search"));

    expect(screen.getByText("No regions loaded yet.")).toBeInTheDocument();
  });

  it("renders date/total chips and clears them individually", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterSidebar value={ACTIVE} onChange={onChange} regionOptions={regions} />);

    expect(screen.getByText("2026-01-01 → 2026-01-31")).toBeInTheDocument();
    expect(screen.getByText("$5 – $500")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove 2026-01-01 → 2026-01-31" }));
    expect(onChange).toHaveBeenCalledWith({ ...ACTIVE, from: "", to: "" });

    await user.click(screen.getByRole("button", { name: "Remove $5 – $500" }));
    expect(onChange).toHaveBeenCalledWith({ ...ACTIVE, totalMin: "", totalMax: "" });
  });

  it("clears everything via Clear all", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterSidebar value={ACTIVE} onChange={onChange} regionOptions={regions} />);

    await user.click(screen.getByTestId("filter-clear"));

    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it("updates date inputs immediately", () => {
    const onChange = vi.fn();
    render(
      <FilterSidebar value={EMPTY_FILTERS} onChange={onChange} regionOptions={regions} />,
    );

    const from = screen.getByLabelText(/From/);
    fireEvent.change(from, { target: { value: "2026-02-01" } });

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, from: "2026-02-01" });
  });

  it("debounces total-range changes", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(
        <FilterSidebar value={EMPTY_FILTERS} onChange={onChange} regionOptions={regions} />,
      );

      fireEvent.change(screen.getByLabelText("Minimum total"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Minimum total"), { target: { value: "10" } });
      expect(onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(400);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, totalMin: "10", totalMax: "" });

      // localMin persists in component state, so the max commit carries it along
      fireEvent.change(screen.getByLabelText("Maximum total"), { target: { value: "99" } });
      vi.advanceTimersByTime(400);
      expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, totalMin: "10", totalMax: "99" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the active filter count on the mobile trigger and opens/closes the drawer", async () => {
    const user = userEvent.setup();
    render(<FilterSidebar value={ACTIVE} onChange={vi.fn()} regionOptions={regions} />);

    // 2 statuses + 1 region + 1 date chip + 1 total chip
    const trigger = screen.getByRole("button", { name: "Filters (5)" });
    await user.click(trigger);
    expect(screen.getByTestId("filter-sidebar")).toHaveClass("translate-x-0");

    await user.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.getByTestId("filter-sidebar")).toHaveClass("-translate-x-full");
  });

  it("collapses and expands on desktop", async () => {
    const user = userEvent.setup();
    render(<FilterSidebar value={EMPTY_FILTERS} onChange={vi.fn()} regionOptions={regions} />);

    await user.click(screen.getByRole("button", { name: "Collapse filters" }));
    expect(screen.getByTestId("filter-sidebar")).toHaveClass("lg:w-12");

    await user.click(screen.getByRole("button", { name: "Expand filters" }));
    expect(screen.getByTestId("filter-sidebar")).toHaveClass("lg:w-64");
  });
});
