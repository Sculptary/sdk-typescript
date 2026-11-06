import { describe, expect, it } from "vitest";
import { Sculptary, SculptaryError, type Collection, type Comment, type GeometryComparison, type Repository, type SpatialAnchor } from "../src/index";

type Call = { url: URL; init: RequestInit };

function mock(handler: (url: URL, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { calls, client: new Sculptary({ token: "sdb_pat_x", host: "https://example.test/", fetch }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const collection: Collection = {
  id: "collection-1", owner: { slug: "studio", kind: "organization", display_name: "Studio", avatar_url: "" },
  slug: "kits", name: "Kits", description: "Reusable models", visibility: "private", created_by: "user-1",
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T00:00:00Z", item_count: 1, viewer_can_manage: true,
  items: [{ repository: { full_name: "alice/castle" } as Repository, note: "Use the tower", position: 0 }],
  future_field: "retained",
};
const anchor: SpatialAnchor = {
  point: [1, -2, 3], normal: [0, 1, 0], object: "Tower",
  camera: { position: [4, 5, 6], target: [1, 2, 3], zoom: 1.5 }, future_field: true,
};
const comment: Comment = {
  id: "comment-1", author: { username: "alice", display_name: "Alice", avatar_url: "" },
  body: "Check this\nedge", body_html: "<p>Check this</p>", path: "models/castle.glb", line: null,
  commit_sha: "abc", spatial_anchor: anchor, review_id: null,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
};

describe("collections", () => {
  it("uses the collection contract for all operations, including organization lists", async () => {
    const expected: [string, string, unknown, unknown][] = [
      ["GET", "/users/alice/collections", undefined, [collection]],
      ["GET", "/users/studio/collections", undefined, [collection]],
      ["GET", "/collections/studio/kits", undefined, collection],
      ["POST", "/collections", { name: "Kits", owner: "studio", slug: "kits", description: "Reusable models", visibility: "private" }, collection],
      ["PATCH", "/collections/studio/kits", { name: "New kits", slug: "new", description: "", visibility: "public" }, collection],
      ["PUT", "/collections/studio/kits/items/alice/castle", { note: "Use the tower" }, collection],
      ["PUT", "/collections/studio/kits/items/alice/castle", { note: null }, collection],
      ["PUT", "/collections/studio/kits/items/alice/castle", { note: "" }, collection],
      ["POST", "/collections/studio/kits/order", { full_names: ["alice/castle"] }, collection],
      ["GET", "/repos/alice/castle/collections", undefined, [collection]],
      ["DELETE", "/collections/studio/kits/items/alice/castle", undefined, undefined],
      ["DELETE", "/collections/studio/kits", undefined, undefined],
    ];
    const { client } = mock((url, init) => {
      const [method, path, body, response] = expected.shift()!;
      expect(init.method).toBe(method);
      expect(url.pathname).toBe(`/api/v1${path}`);
      expect(url.search).toBe("");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sdb_pat_x");
      expect(init.body ? JSON.parse(init.body as string) : undefined).toEqual(body);
      return response === undefined ? new Response(null, { status: 204 }) : json(response);
    });
    expect(await client.collections.listFor("alice")).toEqual([collection]);
    expect(await client.collections.listFor("studio")).toEqual([collection]);
    expect((await client.collections.get("studio/kits")).items?.[0].note).toBe("Use the tower");
    expect((await client.collections.create({ name: "Kits", owner: "studio", slug: "kits", description: "Reusable models", visibility: "private" })).future_field).toBe("retained");
    await client.collections.update("studio/kits", { name: "New kits", slug: "new", description: "", visibility: "public" });
    await client.collections.addItem("studio/kits", "alice/castle", "Use the tower");
    await client.collections.addItem("studio/kits", "alice/castle");
    await client.collections.addItem("studio/kits", "alice/castle", "");
    await client.collections.reorder("studio/kits", ["alice/castle"]);
    expect(await client.collections.containing("alice/castle")).toEqual([collection]);
    expect(await client.collections.removeItem("studio/kits", "alice/castle")).toBeUndefined();
    expect(await client.collections.delete("studio/kits")).toBeUndefined();
    expect(expected).toHaveLength(0);
  });

  it("keeps defaults, explicit empty descriptions and empty order lists", async () => {
    const { calls, client } = mock(() => json(collection));
    await client.collections.create({ name: "Kits" });
    await client.collections.update("studio/kits", { description: "" });
    await client.collections.reorder("studio/kits", []);
    expect(calls.map(({ init }) => JSON.parse(init.body as string))).toEqual([
      { name: "Kits", description: "", visibility: "public" }, { description: "" }, { full_names: [] },
    ]);
  });
});

describe("spatial comments", () => {
  it("lists anchors via PR detail and posts comments and quoted replies", async () => {
    const { calls, client } = mock((url, init) => {
      if (init.method === "GET") {
        expect(url.pathname).toBe("/api/v1/repos/alice/castle/pulls/7");
        return json({ comments: [comment, { ...comment, spatial_anchor: null }] });
      }
      expect(url.pathname).toBe("/api/v1/repos/alice/castle/pulls/7/comments");
      return json({ ...comment, ...JSON.parse(init.body as string) }, 201);
    });
    const comments = await client.pulls.comments("alice/castle", 7);
    expect(comments[0].spatial_anchor).toEqual(anchor);
    expect(comments[1].spatial_anchor).toBeNull();
    expect((await client.pulls.comment("alice/castle", 7, "Fix this", { path: "models/castle.glb", spatialAnchor: anchor, commitSha: "abc" })).spatial_anchor).toEqual(anchor);
    const reply = await client.pulls.reply("alice/castle", 7, "comment-1", "Fixed");
    expect(reply.body).toBe("> Check this\n> edge\n\nFixed");
    expect(reply.path).toBe(comment.path);
    expect(reply.spatial_anchor).toEqual(anchor);
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({
      body: "> Check this\n> edge\n\nFixed", path: comment.path, line: null, commit_sha: "abc", spatial_anchor: anchor,
    });
    expect(calls.every(({ init }) => (init.headers as Record<string, string>).Authorization === "Bearer sdb_pat_x")).toBe(true);
  });

  it("replies to unanchored comments and rejects a missing parent without posting", async () => {
    const { calls, client } = mock((_url, init) => init.method === "GET"
      ? json({ comments: [{ ...comment, spatial_anchor: null, path: null, author: null }] })
      : json(JSON.parse(init.body as string), 201));
    expect((await client.pulls.reply("alice/castle", 7, "comment-1", "Done")).spatial_anchor).toBeNull();
    await expect(client.pulls.reply("alice/castle", 7, "missing", "Hello")).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(calls.map(({ init }) => init.method)).toEqual(["GET", "POST", "GET"]);
  });
});

describe("model comparisons", () => {
  it("encodes refs and paths, supports renamed files and preserves all heatmap data", async () => {
    const deviation: GeometryComparison = {
      id: "cmp-1", status: "ready", heatmap_url: "/api/v1/repos/a/b/comparisons/cmp-1/heatmap",
      result: { method: "sampled-surface-nearest-neighbour", confidence: "medium", resolution: 0.02, hausdorff: 0.4,
        heatmap: { scale_min: 0, scale_max: 0.4, unit: "model units" }, future_heatmap_samples: [0, 0.2, 0.4] },
    };
    const { client } = mock((url, init) => {
      expect(init.method).toBe("GET");
      expect(Object.fromEntries(url.searchParams)).toEqual({ path: "models/new #1.glb", base: "feature/a+b", head: "release/2", base_path: "models/old &1.glb" });
      expect(["/api/v1/repos/alice/castle/asset-compare", "/api/v1/repos/alice/castle/geometry-compare"]).toContain(url.pathname);
      return json(url.pathname.endsWith("/geometry-compare") ? deviation : { base: null, head: null, status: "added", diff: null });
    });
    expect((await client.assets.compare("alice/castle", "models/new #1.glb", "feature/a+b", "release/2", { basePath: "models/old &1.glb" })).diff).toBeNull();
    expect(await client.assets.geometryCompare("alice/castle", "models/new #1.glb", "feature/a+b", "release/2", { basePath: "models/old &1.glb" })).toEqual(deviation);
  });

  it.each([
    ["waiting", {}], ["pending", {}], ["running", {}],
    ["failed", { error: "Unsupported geometry" }],
    ["ready", { comparable: false, reason: "One side has no surface geometry." }],
  ])("returns %s results without assuming measurements exist", async (status, result) => {
    const response = { id: null, status, result, heatmap_url: null };
    const { client } = mock((url) => {
      expect(url.searchParams.has("base_path")).toBe(false);
      return json(response);
    });
    expect(await client.assets.geometryCompare("a/b", "m.glb", "main", "feature")).toEqual(response);
  });

  it("returns metadata deltas and nullable sides", async () => {
    const diff = { statistics: { triangle_count: { base: 10, head: 12, delta: 2 }, node_count: { base: null, head: 2, delta: null } },
      bounding_box: { base: null, head: { size: [1, 2, 3] }, size_changed: true }, materials: { added: ["Stone"], removed: ["Wood"] } };
    const responses = [{ base: null, head: {}, status: "added", diff: null }, { base: {}, head: null, status: "removed", diff: null }, { base: {}, head: {}, status: "modified", diff }];
    const { client } = mock((url) => {
      expect(url.searchParams.has("base_path")).toBe(false);
      return json(responses.shift());
    });
    expect((await client.assets.compare("a/b", "m.glb", "base", "head")).base).toBeNull();
    expect((await client.assets.compare("a/b", "m.glb", "base", "head")).head).toBeNull();
    expect((await client.assets.compare("a/b", "m.glb", "base", "head")).diff).toEqual(diff);
  });
});

it.each([401, 403, 404, 422])("uses structured errors on new resources (%s)", async (status) => {
  const { client } = mock(() => json({ error: { code: "invalid", message: "No access", field: "name" } }, status));
  for (const operation of [() => client.collections.get("studio/kits"), () => client.collections.delete("studio/kits"),
    () => client.pulls.comment("a/b", 1, "Hello"), () => client.assets.geometryCompare("a/b", "m.glb", "a", "b")]) {
    await expect(operation()).rejects.toBeInstanceOf(SculptaryError);
    await expect(operation()).rejects.toMatchObject({ status, code: "invalid", field: "name" });
  }
});
