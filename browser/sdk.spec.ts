import { expect, test } from "@playwright/test";

for (const origin of ["same", "cross"]) {
  test(`native browser fetch supports ${origin}-origin pages, retries, uploads and cancellation`, async ({ page, request, baseURL }) => {
    await request.get(`${baseURL}/reset`);
    await page.goto(origin === "same" ? baseURL! : "http://127.0.0.1:18651");
    const result = await page.evaluate(async host => {
      const { Sculptary } = await import(`${host}/dist/index.js`);
      const client = new Sculptary({ host, token: "fixture-token", retryBaseDelayMs: 0 });
      const ids = []; for await (const repo of client.repos.iterMine({ perPage: 1 })) ids.push(repo.id);
      const recovered = await client.request("GET", "/disconnect");
      const bytes = Array.from(new Uint8Array(await client.download("/redirect")));
      const upload = await client.contents.upload("a/b", { "models/model.obj": "fixture bytes" }, { message: "Fixture", branch: "main", expectedHead: "fixture-head" });
      let mutation; try { await client.request("POST", "/mutate", { json: {} }); } catch (error) { mutation = (error as { status: number }).status; }
      let external; try { for await (const _ of client.paginate("/foreign-next", { key: null })) {} } catch (error) { external = (error as { code: string }).code; }
      const controller = new AbortController();
      const pending = client.request("GET", "/slow", { signal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      let cancelled; try { await pending; } catch (error) { cancelled = (error as Error).name; }
      return { ids, recovered, bytes, upload, mutation, external, cancelled };
    }, baseURL!);
    expect(result).toMatchObject({ ids: [1, 2], recovered: { username: "alice" }, bytes: [1, 2, 3], upload: { multipart: true }, mutation: 503, external: "invalid_pagination", cancelled: "AbortError" });
    const calls = await (await request.get(`${baseURL}/stats`)).json();
    const downloads = calls.filter((r: { path: string }) => r.path === "/bytes");
    expect(downloads.every((r: { authorization: string | null }) => r.authorization === null)).toBe(true);
    expect(downloads.filter((r: { method: string }) => r.method === "GET")).toHaveLength(1);
    expect(calls.filter((r: { path: string }) => r.path === "/api/v1/redirect")).toHaveLength(1);
    expect(calls.filter((r: { path: string }) => r.path === "/api/v1/mutate")).toHaveLength(1);
    expect(calls.filter((r: { path: string }) => r.path === "/api/v1/slow")).toHaveLength(1);
  });
}
