import { describe, expect, it } from "vitest";
import { ShapesDB, ShapesDBError } from "../src/index";

type Call = { url: string; init: RequestInit };

function mock(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as typeof globalThis.fetch;
  return { calls, client: new ShapesDB({ token: "sdb_pat_x", host: "https://example.test/", fetch }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ShapesDB client", () => {
  it("sends the token and builds URLs", async () => {
    const { calls, client } = mock(() => json({ full_name: "a/b" }));
    await client.repos.get("a/b");
    expect(calls[0].url).toBe("https://example.test/api/v1/repos/a/b");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sdb_pat_x");
  });

  it("raises structured errors", async () => {
    const { client } = mock(() => json({ error: { code: "not_found", message: "Repository not found." } }, 404));
    await expect(client.repos.get("a/missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(client.repos.get("a/missing")).rejects.toBeInstanceOf(ShapesDBError);
  });

  it("uploads multipart with explicit paths and the branch head", async () => {
    const { calls, client } = mock((url) =>
      url.endsWith("/branches") ? json([{ name: "main", commit: "abc", protected: false, default: true }]) : json({ commit: "def", ref: "refs/heads/main" }),
    );
    const out = await client.contents.upload("a/b", { "models/t.stl": "solid t\nendsolid t\n" }, { message: "Add", branch: "main" });
    expect(out.commit).toBe("def");
    const form = calls.at(-1)!.init.body as FormData;
    expect(form.get("expected_head")).toBe("abc");
    expect(form.getAll("paths")).toEqual(["models/t.stl"]);
    expect((form.get("files") as File).name).toBe("t.stl");
  });

  it("skips empty query values", async () => {
    const { calls, client } = mock(() => json({ entries: [] }));
    await client.contents.tree("a/b");
    expect(calls[0].url).toBe("https://example.test/api/v1/repos/a/b/tree");
  });
});

describe.skipIf(!process.env.SHAPESDB_TEST_HOST)("live", () => {
  it("searches public repositories", async () => {
    const res = await new ShapesDB({ host: process.env.SHAPESDB_TEST_HOST }).search("castle");
    expect(res.items.every((r) => r.visibility === "public")).toBe(true);
  });
});
