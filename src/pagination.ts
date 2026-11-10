import { SculptaryError } from "./index.js";

export type Query = Record<string, string | number | boolean | undefined | null>;
export interface IterationOptions { perPage?: number; signal?: AbortSignal }
export interface PaginationOptions extends IterationOptions { query?: Query; key?: string | null }

export function pageSize(options: IterationOptions, max = 200): number {
  const size = options.perPage ?? Math.min(100, max);
  if (!Number.isSafeInteger(size) || size < 1 || size > max) throw new RangeError(`perPage must be an integer from 1 to ${max}.`);
  return size;
}

const invalid = () => new SculptaryError(502, "invalid_pagination", "The server returned missing or non-advancing pagination metadata.");

function urlKey(url: URL): string {
  const normalized = new URL(url);
  normalized.hash = "";
  normalized.searchParams.sort();
  return normalized.href;
}

function nextLink(header: string | null): string | undefined {
  if (!header) return;
  for (const match of header.matchAll(/<([^>]+)>([^<]*)/g)) {
    const rel = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(match[2]);
    if ((rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("next")) return match[1];
  }
}

export async function* iteratePages<T>(initial: URL, load: (url: string) => Promise<Response>, options: PaginationOptions): AsyncGenerator<T> {
  const size = pageSize(options);
  if (options.query && ("page" in options.query || "per_page" in options.query)) throw new TypeError("The iterator manages page and per_page.");
  let url = new URL(initial);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", String(size));
  const seen = new Set<string>();
  const key = options.key === undefined ? "items" : options.key;
  for (;;) {
    options.signal?.throwIfAborted();
    if (url.origin !== initial.origin || url.username || url.password || seen.has(urlKey(url))) throw invalid();
    seen.add(urlKey(url));
    const response = await load(url.href);
    const data: unknown = await response.json();
    const meta = data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const items = key === null ? data : meta[key];
    if (!Array.isArray(items)) throw invalid();
    const page = Number(url.searchParams.get("page"));
    if (!Number.isSafeInteger(page) || page < 1 || (meta.page !== undefined && meta.page !== page)) throw invalid();
    let next: URL | undefined;
    const link = nextLink(response.headers.get("Link"));
    if (link) {
      try { next = new URL(link, response.url || url.href); } catch { throw invalid(); }
    } else {
      let more: boolean;
      if (meta.has_more !== undefined) {
        if (typeof meta.has_more !== "boolean") throw invalid();
        more = meta.has_more;
      } else if (response.headers.has("X-Has-More")) {
        const hint = response.headers.get("X-Has-More");
        if (hint !== "true" && hint !== "false") throw invalid();
        more = hint === "true";
      } else if (meta.total !== undefined) {
        if (typeof meta.total !== "number" || !Number.isSafeInteger(meta.total) || meta.total < 0) throw invalid();
        more = page * size < meta.total;
      } else throw invalid();
      if (more) { next = new URL(url); next.searchParams.set("page", String(page + 1)); }
    }
    if (next && (!items.length || next.origin !== initial.origin || next.username || next.password || seen.has(urlKey(next)))) throw invalid();
    for (const item of items) { options.signal?.throwIfAborted(); yield item as T; }
    if (!next) return;
    url = next;
  }
}
