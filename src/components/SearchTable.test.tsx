import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchTable, { type SearchResponse } from "./SearchTable";
import { EMPTY_FILTERS } from "./FilterSidebar";

function orderRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    customer: { firstName: "John", lastName: "Doe", email: "j@x.com" },
    items: [{}, {}],
    total: 42.5,
    notes: "note " + id,
    placedAt: "2026-01-15T10:30:00.000Z",
    region: { code: "US-E", name: "US East" },
    ...overrides,
  };
}

function response(partial: Partial<SearchResponse> = {}): SearchResponse {
  return { data: [orderRow(1)], page: 1, totalPages: 1, total: 1, ...partial };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({ ok, status, json: async () => body });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SearchTable", () => {
  it("fetches and renders rows with formatted cells", async () => {
    mockFetchOnce(response());
    render(<SearchTable />);

    const row = await screen.findByTestId("search-result");
    expect(within(row).getByText("John Doe")).toBeInTheDocument();
    expect(within(row).getByText("$42.50")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument(); // items count
    expect(within(row).getByText("note 1")).toBeInTheDocument();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/orders?");
    expect(url).toContain("page=1");
    expect(url).toContain("pageSize=20");
    expect(url).toContain("sort=placedAt");
    expect(url).toContain("dir=desc");
  });

  it("falls back to the customer email when there is no name", async () => {
    mockFetchOnce(
      response({ data: [orderRow(1, { customer: { email: "only@x.com" } })] }),
    );
    render(<SearchTable />);

    expect(await screen.findByText("only@x.com")).toBeInTheDocument();
  });

  it("shows an error message when the fetch fails", async () => {
    mockFetchOnce({}, false, 500);
    render(<SearchTable />);

    expect(await screen.findByText(/Search failed: HTTP 500/)).toBeInTheDocument();
  });

  it("shows 'No results.' for an empty page", async () => {
    mockFetchOnce(response({ data: [], total: 0 }));
    render(<SearchTable />);

    expect(await screen.findByText("No results.")).toBeInTheDocument();
  });

  it("commits the search on Enter and resets to page 1", async () => {
    const user = userEvent.setup();
    mockFetchOnce(response());
    const onQueryChange = vi.fn();
    render(<SearchTable onQueryChange={onQueryChange} />);
    await screen.findByTestId("search-result");

    mockFetchOnce(response());
    await user.type(screen.getByTestId("search-input"), "smith");
    expect(fetchMock).toHaveBeenCalledTimes(1); // typing alone doesn't fetch

    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain("q=smith");
    expect(onQueryChange).toHaveBeenLastCalledWith("smith");
  });

  it("recommits immediately when the input is cleared (e.g. the native ×)", async () => {
    const user = userEvent.setup();
    mockFetchOnce(response());
    const onQueryChange = vi.fn();
    render(<SearchTable onQueryChange={onQueryChange} />);
    await screen.findByTestId("search-result");

    mockFetchOnce(response());
    const input = screen.getByTestId("search-input");
    await user.type(input, "smith");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Clearing fires only a change event (no keydown) — same as clicking the
    // native type="search" × button — and must recommit without an Enter.
    mockFetchOnce(response());
    await user.clear(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toContain("q=&");
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("toggles sort column and direction via the headers", async () => {
    const user = userEvent.setup();
    mockFetchOnce(response());
    render(<SearchTable />);
    await screen.findByTestId("search-result");

    mockFetchOnce(response());
    await user.click(screen.getByTestId("sort-total"));
    await waitFor(() =>
      expect(fetchMock.mock.calls[1][0]).toContain("sort=total&dir=asc"),
    );
    expect(screen.getByTestId("sort-total")).toHaveAttribute("aria-sort", "ascending");

    mockFetchOnce(response());
    await user.click(screen.getByTestId("sort-total"));
    await waitFor(() =>
      expect(fetchMock.mock.calls[2][0]).toContain("sort=total&dir=desc"),
    );
    expect(screen.getByTestId("sort-total")).toHaveAttribute("aria-sort", "descending");
  });

  it("paginates with Prev/Next and windows page numbers with ellipses", async () => {
    const user = userEvent.setup();
    mockFetchOnce(response({ totalPages: 20, total: 400 }));
    render(<SearchTable />);
    await screen.findByTestId("search-result");

    expect(screen.getByText(/Page 1 of 20/)).toBeInTheDocument();
    expect(screen.getByTestId("page-1")).toBeInTheDocument();
    expect(screen.getByTestId("page-20")).toBeInTheDocument();
    expect(screen.queryByTestId("page-10")).not.toBeInTheDocument();
    expect(screen.getByTestId("prev-page")).toBeDisabled();

    mockFetchOnce(response({ totalPages: 20, total: 400, page: 2 }));
    await user.click(screen.getByTestId("next-page"));
    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toContain("page=2"));

    mockFetchOnce(response({ totalPages: 20, total: 400 }));
    // the testid sits on the <li>; the clickable control is the button inside
    await user.click(within(screen.getByTestId("page-20")).getByRole("button"));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toContain("page=20"));
  });

  it("uses a keyset cursor for Next/Prev on the default sort, not plain OFFSET paging", async () => {
    const user = userEvent.setup();
    mockFetchOnce(
      response({
        totalPages: 20,
        total: 400,
        data: [orderRow(1, { placedAt: "2026-01-15T10:30:00.000Z" })],
      }),
    );
    render(<SearchTable />);
    await screen.findByTestId("search-result");

    mockFetchOnce(
      response({
        totalPages: 20,
        total: 400,
        page: 2,
        data: [orderRow(2, { placedAt: "2026-01-14T10:30:00.000Z" })],
      }),
    );
    await user.click(screen.getByTestId("next-page"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const nextUrl = fetchMock.mock.calls[1][0] as string;
    expect(nextUrl).toContain("cursorId=1");
    expect(nextUrl).toContain("cursorDir=next");
    expect(nextUrl).toContain("cursorPlacedAt=2026-01-15T10%3A30%3A00.000Z");

    mockFetchOnce(
      response({
        totalPages: 20,
        total: 400,
        data: [orderRow(1, { placedAt: "2026-01-15T10:30:00.000Z" })],
      }),
    );
    await user.click(screen.getByTestId("prev-page"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const prevUrl = fetchMock.mock.calls[2][0] as string;
    expect(prevUrl).toContain("cursorId=2");
    expect(prevUrl).toContain("cursorDir=prev");
  });

  it("falls back to plain OFFSET paging for Next when sorted by a non-default column", async () => {
    const user = userEvent.setup();
    mockFetchOnce(response({ totalPages: 20, total: 400 }));
    render(<SearchTable />);
    await screen.findByTestId("search-result");

    mockFetchOnce(response({ totalPages: 20, total: 400 }));
    await user.click(screen.getByTestId("sort-total"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    mockFetchOnce(response({ totalPages: 20, total: 400, page: 2 }));
    await user.click(screen.getByTestId("next-page"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const url = fetchMock.mock.calls[2][0] as string;
    expect(url).toContain("page=2");
    expect(url).not.toContain("cursorId");
  });

  it("uses the keyset cursor when clicking the sibling page number, not just the Next button", async () => {
    const user = userEvent.setup();
    mockFetchOnce(
      response({
        totalPages: 20,
        total: 400,
        data: [orderRow(1, { placedAt: "2026-01-15T10:30:00.000Z" })],
      }),
    );
    render(<SearchTable />);
    await screen.findByTestId("search-result");

    // On page 1 of 20, the windowed pagination shows "2" as a sibling link —
    // clicking that number is the same destination as clicking Next.
    mockFetchOnce(
      response({
        totalPages: 20,
        total: 400,
        page: 2,
        data: [orderRow(2, { placedAt: "2026-01-14T10:30:00.000Z" })],
      }),
    );
    await user.click(within(screen.getByTestId("page-2")).getByRole("button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = fetchMock.mock.calls[1][0] as string;
    expect(url).toContain("cursorId=1");
    expect(url).toContain("cursorDir=next");
  });

  it("appends the sidebar filters to the request", async () => {
    mockFetchOnce(response());
    render(
      <SearchTable
        filters={{ ...EMPTY_FILTERS, status: ["PENDING"], regionCodes: ["US-E"] }}
      />,
    );

    await screen.findByTestId("search-result");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("status=PENDING");
    expect(url).toContain("regionCode=US-E");
  });

  it("uses externalTotal when list total is capped by the backend", async () => {
    mockFetchOnce(response({ total: 10000, approximate: true }));
    render(<SearchTable externalTotal={78448} />);

    const total = await screen.findByTestId("search-total");
    expect(total).toHaveTextContent("78,448");
    expect(total).toHaveAttribute("data-total", "78448");
  });

  it("reports fetched rows through onRows", async () => {
    mockFetchOnce(response());
    const onRows = vi.fn();
    render(<SearchTable onRows={onRows} />);

    await screen.findByTestId("search-result");
    expect(onRows).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
  });

  it("renders controlled data without fetching", async () => {
    const onRequestStateChange = vi.fn();
    render(
      <SearchTable
        controlledResponse={response({ data: [orderRow(7)], total: 1 })}
        onRequestStateChange={onRequestStateChange}
      />,
    );

    expect(await screen.findByTestId("search-result")).toHaveAttribute("data-id", "7");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onRequestStateChange).toHaveBeenCalledWith({
      q: "",
      page: 1,
      pageSize: 20,
      sort: "placedAt",
      dir: "desc",
    });
  });

  it("shows controlled errors", async () => {
    render(
      <SearchTable
        controlledError="boom"
        onRequestStateChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Search failed: boom/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flashes the highlighted row when it appears", async () => {
    mockFetchOnce(response({ data: [orderRow(9)] }));
    render(<SearchTable highlightId={9} highlightKey={1} />);

    const row = await screen.findByTestId("search-result");
    await waitFor(() => expect(row).toHaveClass("row-insert"));
    expect(row).toHaveAttribute("data-new", "true");
  });
});
