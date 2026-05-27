export interface Page<T> {
  items: T[];
  pageIndex: number;   // clamped to a valid index for the input list
  totalPages: number;  // at least 1, even when items.length === 0
  totalItems: number;
}

export function paginate<T>(
  items: T[],
  pageIndex: number,
  pageSize: number
): Page<T> {
  if (pageSize <= 0) {
    throw new Error("pageSize must be > 0");
  }
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clamped = Math.min(Math.max(0, Math.floor(pageIndex)), totalPages - 1);
  const start = clamped * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pageIndex: clamped,
    totalPages,
    totalItems,
  };
}
