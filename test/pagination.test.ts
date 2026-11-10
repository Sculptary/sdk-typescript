import { describe, expect, it } from "vitest";
import { Sculptary } from "../src/index";

const json = (body: unknown, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { headers });
const collect = async <T>(items: AsyncIterable<T>) => { const result: T[] = []; for await (const item of items) result.push(item); return result; };

function mock(handler: (url: URL, init: RequestInit) => Response) {
  const calls: URL[] = [];
  const client = new Sculptary({ host: "https://example.test", token: "test-token", fetch: (async (input, init) => {
    const url = new URL(String(input)); calls.push(url); return handler(url, init ?? {});
  }) as typeof fetch });
  return { client, calls };
}

describe("pagination", () => {
  it("loads lazily, follows relative and absolute next links, and stops on early exit", async () => {
    const { client, calls } = mock((url, init) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      const page = Number(url.searchParams.get("page"));
      return json([page], { Link: `<${page === 1 ? "/api/v1/user/repos?page=2&per_page=1" : "https://example.test/api/v1/user/repos?page=3&per_page=1"}>; rel="next"` });
    });
    const items = client.paginate<number>("/user/repos", { key: null, perPage: 1 });
    expect(calls).toHaveLength(0);
    for await (const item of items) { if (item === 2) break; }
    expect(calls.map(url => url.pathname + url.search)).toEqual(["/api/v1/user/repos?page=1&per_page=1", "/api/v1/user/repos?page=2&per_page=1"]);
  });

  it.each(["body", "header", "total"])("uses explicit %s metadata and preserves filters", async (metadata) => {
    const { client, calls } = mock((url) => {
      const page = Number(url.searchParams.get("page"));
      expect(url.searchParams.get("q")).toBe("castle & kit");
      const data = { items: [page], page, ...(metadata === "body" ? { has_more: page < 3 } : metadata === "total" ? { total: 3 } : {}) };
      return json(data, metadata === "header" ? { "X-Has-More": String(page < 3) } : {});
    });
    expect(await collect(client.paginate("/search/repositories", { query: { q: "castle & kit" }, perPage: 1 }))).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(3);
  });

  it.each([
    ["external", [1], { Link: '<https://other.test/list?page=2>; rel="next"' }],
    ["cycle", [1], { Link: '</api/v1/user/repos?per_page=1&page=1>; rel="prev next"' }],
    ["missing metadata", [1], {}],
    ["invalid metadata", [1], { "X-Has-More": "maybe" }],
    ["empty progress", [], { "X-Has-More": "true" }],
    ["invalid items", { has_more: false }, {}],
    ["wrong page", { items: [1], page: 2, has_more: false }, {}],
  ])("rejects %s without sending another request", async (_name, body, headers) => {
    const { client, calls } = mock(() => json(body, headers));
    await expect(collect(client.paginate("/user/repos", { key: Array.isArray(body) ? null : "items", perPage: 1 }))).rejects.toMatchObject({ code: "invalid_pagination" });
    expect(calls).toHaveLength(1);
  });

  it("propagates later page permission errors", async () => {
    const { client } = mock(url => url.searchParams.get("page") === "1" ? json([1], { "X-Has-More": "true" }) : new Response(JSON.stringify({ error: { code: "forbidden", message: "No access" } }), { status: 403 }));
    const iterator = client.repos.iterMine({ perPage: 1 });
    expect((await iterator.next()).value).toBe(1);
    await expect(iterator.next()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("supports every paged list helper with endpoint limits", async () => {
    const { client, calls } = mock(url => json(url.pathname.endsWith("/commits") ? { commits: [1], has_more: false, page: 1 } : url.pathname.includes("/search/") ? { items: [1], total: 1, page: 1 } : /\/(issues|pulls)$/.test(url.pathname) ? { items: [1], has_more: false, page: 1 } : [1], { "X-Has-More": "false" }));
    const iterators = [client.iterSearch("castle", { format: "glb" }), client.repos.iterMine(), client.repos.iterFor("studio"), client.repos.iterCommits("a/b", { ref: "v1", path: "m.glb" }), client.issues.iter("a/b", "closed", { filters: { label: "bug" } }), client.pulls.iter("a/b", "merged"), client.releases.iter("a/b")];
    for (const iterator of iterators) expect(await collect(iterator)).toEqual([1]);
    expect(calls.map(url => url.searchParams.get("per_page"))).toEqual(["50", "100", "100", "100", "100", "100", "100"]);
    expect(calls[4].searchParams.get("state")).toBe("closed");
    expect(calls[4].searchParams.get("label")).toBe("bug");
  });

  it("iterates complete unpaged endpoints without inventing pagination", async () => {
    const { client, calls } = mock(url => json(url.pathname.endsWith("/tree") ? { entries: [1] } : url.pathname.endsWith("/assets") ? { assets: [1] } : url.pathname.endsWith("/pulls/7") ? { comments: [{ id: "root", replies: [{ id: "reply" }] }] } : [1]));
    for (const iterator of [client.repos.iterBranches("a/b"), client.contents.iterTree("a/b", "models", "v1"), client.assets.iter("a/b", "v1"), client.assets.iterFormats(), client.collections.iterFor("studio"), client.collections.iterContaining("a/b")]) expect(await collect(iterator)).toEqual([1]);
    expect(await collect(client.pulls.iterComments("a/b", 7))).toEqual([{ id: "root", replies: [{ id: "reply" }] }]);
    expect(calls.every(url => !url.searchParams.has("page"))).toBe(true);
  });

  it("validates options before fetching and honors cancellation between items", async () => {
    const { client, calls } = mock(() => json([1, 2], { "X-Has-More": "false" }));
    for (const perPage of [0, 201, 1.5, NaN]) await expect(collect(client.paginate("/user/repos", { perPage }))).rejects.toBeInstanceOf(RangeError);
    await expect(collect(client.paginate("/user/repos", { query: { page: 2 } }))).rejects.toBeInstanceOf(TypeError);
    await expect(collect(client.iterSearch("", {}, { perPage: 51 }))).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
    const controller = new AbortController();
    const items = client.paginate("/user/repos", { key: null, signal: controller.signal });
    expect((await items.next()).value).toBe(1);
    controller.abort();
    await expect(items.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(1);
  });
});
