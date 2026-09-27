import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useIsDark } from "./useIsDark";

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("useIsDark", () => {
  it("reflects the initial class state", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(true);
  });

  it("tracks class changes live", async () => {
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(false);

    document.documentElement.classList.add("dark");
    await waitFor(() => expect(result.current).toBe(true));

    document.documentElement.classList.remove("dark");
    await waitFor(() => expect(result.current).toBe(false));
  });
});
