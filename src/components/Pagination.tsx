
import { useMemo } from "react";

type PageItem = number | "left-ellipsis" | "right-ellipsis";

function getPageItems(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const sibling = 1;
  const left = Math.max(current - sibling, 1);
  const right = Math.min(current + sibling, total);
  const items: PageItem[] = [1];
  if (left > 2) items.push("left-ellipsis");
  for (let i = Math.max(left, 2); i <= Math.min(right, total - 1); i++) {
    items.push(i);
  }
  if (right < total - 1) items.push("right-ellipsis");
  items.push(total);
  return items;
}

function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

interface PaginationProps {
  page: number;
  totalPages: number;
  loading: boolean;
  footerLoading: boolean;
  externalTotal: number | null | undefined;
  goToPage: (n: number) => void;
  goToAdjacentPage: (direction: "prev" | "next") => void;
}

export default function Pagination({
  page,
  totalPages,
  loading,
  footerLoading,
  externalTotal,
  goToPage,
  goToAdjacentPage,
}: PaginationProps) {
  const pageItems = useMemo(() => getPageItems(page, totalPages), [page, totalPages]);

  if (totalPages <= 1) return null;

  if (footerLoading || externalTotal === null) {
    return (
      <nav aria-label="Pagination">
        <ul className="flex items-center gap-1">
          <li>
            <button type="button" disabled
              className="flex h-9 items-center rounded-md border border-gray-300 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700">
              Prev
            </button>
          </li>
          <li>
            <button type="button" aria-current="page"
              className="flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm bg-indigo-600 text-white">
              {page}
            </button>
          </li>
          <li aria-hidden className="px-1">
            <span className="inline-block h-3 w-24 animate-pulse rounded bg-gray-200 align-middle dark:bg-gray-700" />
          </li>
          <li>
            <button type="button" disabled
              className="flex h-9 items-center rounded-md border border-gray-300 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700">
              Next
            </button>
          </li>
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Pagination">
      <ul className="flex items-center gap-1">
        <li>
          <button
            type="button"
            data-testid="prev-page"
            onClick={() => goToAdjacentPage("prev")}
            disabled={page <= 1 || loading}
            className="flex h-9 items-center rounded-md border border-gray-300 px-3 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Prev
          </button>
        </li>

        {pageItems.map((item) => {
          if (item === "left-ellipsis" || item === "right-ellipsis") {
            return (
              <li key={item} aria-hidden className="px-2 text-sm text-gray-400">
                …
              </li>
            );
          }
          const isActive = item === page;
          const handleClick =
            item === page - 1
              ? () => goToAdjacentPage("prev")
              : item === page + 1
                ? () => goToAdjacentPage("next")
                : () => goToPage(item);
          return (
            <li key={item} data-testid={`page-${item}`}>
              <button
                type="button"
                onClick={handleClick}
                aria-current={isActive ? "page" : undefined}
                data-testid={isActive ? "current-page" : undefined}
                className={cn(
                  "flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm transition-colors",
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "border border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800",
                )}
              >
                {item}
              </button>
            </li>
          );
        })}

        <li>
          <button
            type="button"
            data-testid="next-page"
            onClick={() => goToAdjacentPage("next")}
            disabled={page >= totalPages || loading}
            className="flex h-9 items-center rounded-md border border-gray-300 px-3 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Next
          </button>
        </li>
      </ul>
    </nav>
  );
}
