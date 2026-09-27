import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  fetchMock = vi.fn((input: string) => {
    const url = String(input);
    if (url.startsWith("/api/regions")) {
      return Promise.resolve(
        jsonResponse([
          { id: 1, code: "US-E", name: "US East" },
          { id: 2, code: "EU-W", name: "EU West" },
        ]),
      );
    }
    if (url.startsWith("/api/orders")) {
      return Promise.resolve(
        jsonResponse({
          data: [
            {
              id: 1,
              customer: { firstName: "Ann", lastName: "Lee", email: "a@x.com" },
              items: [],
              total: 10,
              notes: null,
              placedAt: "2026-01-15T10:30:00.000Z",
              // A region not present in /api/regions — discovered from rows
              region: { code: "AP-S", name: "AP South" },
            },
          ],
          page: 1,
          totalPages: 1,
          total: 1,
        }),
      );
    }
    // /api/aggregates
    return Promise.resolve(jsonResponse({ data: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("App", () => {
  it("renders the dashboard shell", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("filter-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    await screen.findByTestId("search-result");
  });

  it("merges regions from /api/regions and from fetched order rows", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("search-result");

    await user.click(screen.getByTestId("filter-region-search"));

    await waitFor(() => {
      expect(screen.getByTestId("filter-region-US-E")).toHaveTextContent("US East");
      expect(screen.getByTestId("filter-region-EU-W")).toHaveTextContent("EU West");
      expect(screen.getByTestId("filter-region-AP-S")).toHaveTextContent("AP South");
    });
  });

  it("survives a failing /api/regions request", async () => {
    fetchMock.mockImplementation((input: string) => {
      const url = String(input);
      if (url.startsWith("/api/regions")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      if (url.startsWith("/api/orders")) {
        return Promise.resolve(
          jsonResponse({ data: [], page: 1, totalPages: 1, total: 0 }),
        );
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    render(<App />);

    expect(await screen.findByText("No results.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});
