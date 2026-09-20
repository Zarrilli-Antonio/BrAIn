import { SearchIndex, SearchMatch, SearchOptions } from "./index-store.js";

export type { SearchMatch, SearchOptions };

export function searchCode(index: SearchIndex, query: string, useRegex = false, opts: SearchOptions = {}): SearchMatch[] {
  return index.search(query, useRegex, opts);
}
