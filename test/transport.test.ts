import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Sculptary } from "../src/index";
import { startServers } from "./support/server.mjs";

describe("native Node fetch", () => {
  let server: Awaited<ReturnType<typeof startServers>>;
  let client: Sculptary;
  beforeAll(async () => { server = await startServers(); client = new Sculptary({ host: server.origin, token: "fixture-token", retryBaseDelayMs: 0 }); });
  beforeEach(() => server.reset());
  afterAll(async () => server?.close());

  it("iterates real HTTP pages across a transient failure", async () => {
    const ids = []; for await (const repo of client.repos.iterMine({ perPage: 1 })) ids.push(repo.id);
    expect(ids).toEqual([1, 2]);
    expect(server.requests.map(r => r.path)).toEqual(["/api/v1/user/repos?page=1&per_page=1", "/api/v1/user/repos?page=1&per_page=1", "/api/v1/user/repos?page=2&per_page=1"]);
  });

  it("recovers from a connection lost after response headers", async () => {
    expect(await client.request("GET", "/disconnect")).toEqual({ username: "alice" });
    expect(server.requests).toHaveLength(2);
  });

  it("strips authentication on signed cross-origin redirects", async () => {
    expect(Array.from(new Uint8Array(await client.download("/redirect")))).toEqual([1, 2, 3]);
    expect(server.requests).toEqual([{ path: "/api/v1/redirect", method: "GET", authorization: "Bearer fixture-token" }, { path: "/bytes", method: "GET", authorization: null }]);
  });

  it("sends real multipart uploads without mutating files", async () => {
    const file = new Uint8Array([1, 2, 3]);
    const result = await client.contents.upload("a/b", { "models/model.obj": file }, { message: "Add fixture", branch: "main", expectedHead: "fixture-head" });
    expect(result).toMatchObject({ commit: "fixture-commit", multipart: true }); expect(file).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("does not replay real mutation requests", async () => {
    await expect(client.request("POST", "/mutate", { json: { name: "fixture" } })).rejects.toMatchObject({ status: 503 });
    expect(server.requests).toHaveLength(1);
  });
});
