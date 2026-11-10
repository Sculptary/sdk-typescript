import { afterEach, describe, expect, it, vi } from "vitest";
import { Sculptary, SculptaryError } from "../src/index";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers });
function client(fetch: typeof globalThis.fetch, options = {}) { return new Sculptary({ host: "https://example.test", fetch, retryBaseDelayMs: 0, ...options }); }

describe("bounded retries", () => {
  it.each([408, 429, 500, 502, 503, 504])("retries HTTP %s and cancels discarded bodies", async status => {
    const cancel = vi.fn(); let attempts = 0;
    const sdb = client(async () => ++attempts < 3 ? new Response(new ReadableStream({ cancel }), { status }) : json({ username: "alice" }));
    expect((await sdb.me()).username).toBe("alice");
    expect(attempts).toBe(3); expect(cancel).toHaveBeenCalledTimes(2);
  });

  it.each(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"])("retries replayable %s requests", async method => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Network failure")).mockResolvedValue(new Response(null, { status: 204 }));
    await client(fetch).request(method, "/example", method === "PUT" ? { json: { name: "Kit" } } : {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["POST", "PATCH"])("never replays %s mutations", async method => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { code: "busy", message: "Try later" } }, 503));
    await expect(client(fetch).request(method, "/example", { json: {} })).rejects.toMatchObject({ status: 503, code: "busy" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves the final error and allows disabling retries", async () => {
    let count = 0;
    const sdb = client(async () => json({ error: { code: "busy", message: `Attempt ${++count}`, field: "name" } }, 503));
    await expect(sdb.me()).rejects.toMatchObject({ status: 503, code: "busy", message: "Attempt 3", field: "name" });
    const fetch = vi.fn().mockRejectedValue(new TypeError("Offline"));
    await expect(client(fetch, { maxRetries: 0 }).me()).rejects.toThrow("Offline");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 409, 422, 501])("does not retry HTTP %s", async status => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { message: "Failure" } }, status));
    await expect(client(fetch).me()).rejects.toBeInstanceOf(SculptaryError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses bounded exponential full jitter", async () => {
    vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({}, 503)).mockResolvedValue(json({ username: "alice" }));
    const pending = client(fetch, { retryBaseDelayMs: 100, retryMaxDelayMs: 120 }).me();
    await vi.advanceTimersByTimeAsync(49); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect((await pending).username).toBe("alice");
  });

  it.each(["2", "Mon, 09 Nov 2026 12:00:02 GMT"])("honors Retry-After %s", async hint => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 429, { "Retry-After": hint })).mockResolvedValue(json({ username: "alice" }));
    const pending = client(fetch).me();
    await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect((await pending).username).toBe("alice");
  });

  it("returns the server error when its retry delay exceeds the configured budget", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { code: "limited", message: "Wait" } }, 429, { "Retry-After": "60" }));
    await expect(client(fetch, { retryMaxDelayMs: 1000 }).me()).rejects.toMatchObject({ status: 429, code: "limited" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts backoff and never fetches with an already aborted signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(json({}, 429, { "Retry-After": "5" }));
    const sdb = client(fetch);
    const pending = sdb.request("GET", "/user", { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejected;
    await vi.runAllTimersAsync(); expect(fetch).toHaveBeenCalledTimes(1);
    await expect(sdb.request("GET", "/user", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries cancellation, programming failures, or one-shot request streams", async () => {
    for (const error of [new DOMException("Aborted", "AbortError"), new Error("Bug")]) {
      const fetch = vi.fn().mockRejectedValue(error);
      await expect(client(fetch).me()).rejects.toBe(error); expect(fetch).toHaveBeenCalledTimes(1);
    }
    const fetch = vi.fn().mockResolvedValue(json({}, 503));
    await expect(client(fetch).raw("PUT", "/example", { body: new ReadableStream() })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("snapshots JSON and mutable byte bodies before retrying", async () => {
    const input = { name: "original" }; const bytes = new Uint8Array([1, 2]);
    for (const init of [{ json: input }, { body: bytes }]) {
      const bodies: unknown[] = [];
      const sdb = client(async (_url, request) => {
        bodies.push(typeof request!.body === "string" ? request!.body : Array.from(request!.body as Uint8Array));
        input.name = "changed"; bytes[0] = 9;
        return bodies.length === 1 ? json({}, 503) : new Response(null, { status: 204 });
      });
      await sdb.request("PUT", "/example", init);
      expect(bodies[1]).toEqual(bodies[0]);
    }
  });

  it("shares one retry budget across response headers and body failures", async () => {
    let attempts = 0;
    const sdb = client(async () => {
      attempts++;
      return attempts === 1 ? json({}, 503) : attempts === 2 ? new Response(new ReadableStream({ start(c) { c.error(new TypeError("Disconnected")); } })) : json({ username: "alice" });
    });
    expect((await sdb.me()).username).toBe("alice"); expect(attempts).toBe(3);
  });

  it("retries interrupted pagination and binary downloads before yielding output", async () => {
    for (const kind of ["pages", "bytes"]) {
      let attempts = 0;
      const sdb = client(async () => ++attempts === 1
        ? new Response(new ReadableStream({ start(c) { c.error(new TypeError("Disconnected")); } }))
        : kind === "pages" ? json([1], 200, { "X-Has-More": "false" }) : new Response(new Uint8Array([1, 2])));
      if (kind === "pages") { const items = []; for await (const item of sdb.paginate("/user/repos", { key: null })) items.push(item); expect(items).toEqual([1]); }
      else expect(Array.from(new Uint8Array(await sdb.download("/bytes")))).toEqual([1, 2]);
      expect(attempts).toBe(2);
    }
  });

  it("does not retry body reads after returning raw response ownership", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError("Disconnected")); } })));
    const response = await client(fetch).raw("GET", "/bytes");
    await expect(response.arrayBuffer()).rejects.toBeInstanceOf(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid", "-1", "Infinity"])("ignores invalid Retry-After %s", async hint => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 503, { "Retry-After": hint })).mockImplementation(async () => json({ username: "alice" }));
    expect((await client(fetch).me()).username).toBe("alice"); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns structured invalid response errors and handles arbitrary error JSON", async () => {
    for (const body of ["null", "[]", "{\"error\":null}", "{\"error\":42}", "{\"error\":{\"message\":42}}", "private redirect URL"]) {
      await expect(client(async () => new Response(body, { status: 403 })).me()).rejects.toMatchObject({ status: 403, code: "error", message: "Request failed (403)" });
    }
    const fetch = vi.fn().mockResolvedValue(new Response("not JSON"));
    await expect(client(fetch).me()).rejects.toMatchObject({ status: 502, code: "invalid_response" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses external absolute URLs before exposing credentials", async () => {
    const fetch = vi.fn();
    await expect(client(fetch).request("GET", "https://other.test/api/v1/user")).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ maxRetries: -1 }, { maxRetries: 1.5 }, { maxRetries: NaN }, { retryBaseDelayMs: -1 }, { retryBaseDelayMs: Infinity }, { retryMaxDelayMs: NaN }, { retryMaxDelayMs: 2 ** 31 }])("validates retry options %j", options => {
    expect(() => client(vi.fn(), options)).toThrow(RangeError);
  });
});
