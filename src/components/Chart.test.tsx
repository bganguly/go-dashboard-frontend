import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Chart, { type RawAggregate } from "./Chart";
import { EMPTY_FILTERS } from "./FilterSidebar";

type BrushRange = { startIndex?: number; endIndex?: number };

// Captures the Brush onChange handler so tests can drive drags in memory,
// without the real SVG layout jsdom can't do.
const captured = vi.hoisted(() => ({
  brushOnChange: undefined as ((range: BrushRange) => void) | undefined,
}));

// jsdom gives ResponsiveContainer zero size; hand the chart a fixed one instead.
vi.mock("recharts", async (importOriginal) => {
  const original = await importOriginal<typeof import("recharts")>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 800, height: 320 } as object),
    Brush: (props: { onChange?: (range: BrushRange) => void }) => {
      captured.brushOnChange = props.onChange;
      return null;
    },
  };
});

function day(date: string, categories: Record<string, number>): RawAggregate {
  return {
    date,
    categories: Object.fromEntries(
      Object.entries(categories).map(([cat, orders]) => [
        cat,
        { totalOrders: orders, totalRevenue: orders * 10, totalItems: orders },
      ]),
    ),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({ ok, status, json: async () => body });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  captured.brushOnChange = undefined;
});

/** Renders a chart with three days of data and waits for the brush to mount. */
async function renderWithBrush(onRangeChange?: (from: string, to: string) => void) {
  mockFetchOnce({
    data: [
      day("2026-01-01", { A: 1 }),
      day("2026-01-02", { A: 2 }),
      day("2026-01-03", { A: 3 }),
    ],
  });
  render(<Chart onRangeChange={onRangeChange} />);
  await waitFor(() => expect(captured.brushOnChange).toBeDefined());
}

describe("Chart", () => {
  it("shows 'No data.' when the API returns nothing", async () => {
    mockFetchOnce({ data: [] });
    render(<Chart />);

    expect(await screen.findByText("No data.")).toBeInTheDocument();
  });

  it("shows the error state on a failed fetch", async () => {
    mockFetchOnce({}, false, 500);
    render(<Chart />);

    expect(await screen.findByText(/Failed: HTTP 500/)).toBeInTheDocument();
  });

  it("requests aggregates with filters and the committed search query", async () => {
    mockFetchOnce({ data: [] });
    render(
      <Chart
        filters={{ ...EMPTY_FILTERS, status: ["PENDING"], from: "2026-01-01", to: "2026-01-31" }}
        searchQuery="smith"
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/aggregates?");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-31");
    expect(url).toContain("topCategories=4");
    expect(url).toContain("status=PENDING");
    expect(url).toContain("q=smith");
  });

  it("renders legend tiles for the top categories and rolls the rest into Others", async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      data: [
        day("2026-01-01", { A: 10, B: 9, C: 8, D: 7, E: 2, F: 1 }),
        day("2026-01-02", { A: 5, B: 4 }),
      ],
    });
    render(<Chart />);

    await waitFor(() =>
      expect(screen.getAllByTestId("aggregate-tile").length).toBeGreaterThan(0),
    );
    const tiles = screen.getAllByTestId("aggregate-tile");
    expect(tiles.map((t) => t.getAttribute("data-category"))).toEqual(["A", "B", "C", "D"]);
    expect(tiles[0]).toHaveTextContent("15"); // A: 10 + 5 orders

    // Others starts hidden; the checkbox reveals its series
    const othersToggle = screen.getByRole("checkbox");
    expect(othersToggle).not.toBeChecked();
    expect(screen.getByText("Others")).toBeInTheDocument();
    await user.click(othersToggle);
    expect(othersToggle).toBeChecked();
  });

  it("brush drag refetches the selected range (debounced) and notifies the parent", async () => {
    const onRangeChange = vi.fn();
    await renderWithBrush(onRangeChange);

    mockFetchOnce({ data: [] });
    act(() => captured.brushOnChange!({ startIndex: 0, endIndex: 1 }));

    // header range updates immediately; the fetch waits for the 250ms debounce
    expect(screen.getByText(/2026-01-01 → 2026-01-02/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = fetchMock.mock.calls[1][0] as string;
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-02");
    expect(onRangeChange).toHaveBeenCalledWith("2026-01-01", "2026-01-02");
  });

  it("coalesces rapid brush drags into one fetch", async () => {
    await renderWithBrush();

    mockFetchOnce({ data: [] });
    act(() => captured.brushOnChange!({ startIndex: 0, endIndex: 1 }));
    act(() => captured.brushOnChange!({ startIndex: 0, endIndex: 2 }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain("to=2026-01-03");
    // no third fetch from the superseded first drag
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores incomplete, out-of-range, and unchanged brush ranges", async () => {
    await renderWithBrush();

    act(() => captured.brushOnChange!({ startIndex: undefined, endIndex: 1 }));
    act(() => captured.brushOnChange!({ startIndex: 0, endIndex: 99 }));
    act(() => captured.brushOnChange!({ startIndex: -1, endIndex: 1 }));
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // a real drag, then the same range again — the repeat is a no-op.
    // Return the same days so the brush (and its buckets) stays mounted.
    mockFetchOnce({
      data: [day("2026-01-01", { A: 1 }), day("2026-01-02", { A: 2 }), day("2026-01-03", { A: 3 })],
    });
    act(() => captured.brushOnChange!({ startIndex: 0, endIndex: 1 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    act(() => captured.brushOnChange!({ startIndex: 0, endIndex: 1 }));
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("calls onTotalChange with the backend totalOrders when data loads", async () => {
    mockFetchOnce({ data: [day("2026-01-01", { A: 3, B: 7 })], totalOrders: 8 });
    const onTotalChange = vi.fn();
    render(<Chart onTotalChange={onTotalChange} />);
    await screen.findByTestId("aggregate-tile-total");
    expect(onTotalChange).toHaveBeenCalledWith(8);
  });
});
