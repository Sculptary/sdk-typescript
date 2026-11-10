// Local HTTP fixtures. No external services or real credentials are used.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function startServers({ port = 0, externalPort = 0 } = {}) {
  const requests = [];
  const counts = new Map();
  const listen = server => new Promise(resolve => server.listen(server === external ? externalPort : port, "127.0.0.1", resolve));
  const json = (res, value, status = 200, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
  const external = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url === "/bytes") {
      requests.push({ path: "/bytes", method: req.method, authorization: req.headers.authorization ?? null });
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); }
      else res.end(Buffer.from([1, 2, 3]));
    }
    else { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>SDK cross-origin fixture</title>"); }
  });
  await listen(external);
  const externalOrigin = `http://127.0.0.1:${external.address().port}`;
  const primary = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Link, X-Has-More, Retry-After");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, "http://fixture.invalid");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>SDK fixture</title>"); return; }
    if (["/dist/index.js", "/dist/pagination.js", "/dist/retry.js", "/dist/errors.js"].includes(url.pathname)) {
      try { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(new URL(`../..${url.pathname}`, import.meta.url))); }
      catch { res.writeHead(404); res.end(); }
      return;
    }
    if (url.pathname === "/stats") { json(res, requests); return; }
    if (url.pathname === "/reset") { requests.length = 0; counts.clear(); json(res, {}); return; }
    const key = url.pathname + url.search;
    const attempt = (counts.get(key) ?? 0) + 1; counts.set(key, attempt);
    requests.push({ path: key, method: req.method, authorization: req.headers.authorization ?? null });
    switch (url.pathname) {
      case "/api/v1/user/repos": {
        const page = Number(url.searchParams.get("page"));
        if (page === 1 && attempt === 1) { json(res, {}, 503, { "Retry-After": "0" }); return; }
        json(res, [{ id: page }], 200, page === 1 ? { Link: '</api/v1/user/repos?page=2&per_page=1>; rel="next"' } : { "X-Has-More": "false" });
        return;
      }
      case "/api/v1/disconnect":
        if (attempt === 1) { res.writeHead(200, { "Content-Type": "application/json" }); res.flushHeaders(); res.write('{"username":'); setTimeout(() => res.destroy(), 20); }
        else json(res, { username: "alice" });
        return;
      case "/api/v1/redirect": res.writeHead(302, { Location: `${externalOrigin}/bytes` }); res.end(); return;
      case "/api/v1/foreign-next": json(res, [1], 200, { Link: `<${externalOrigin}/private>; rel="next"` }); return;
      case "/api/v1/slow": json(res, {}, 429, { "Retry-After": "5" }); return;
      case "/api/v1/mutate": req.resume(); json(res, { error: { code: "busy", message: "Try later" } }, 503); return;
      case "/api/v1/repos/a/b/contents": {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        json(res, { commit: "fixture-commit", ref: "refs/heads/main", multipart: body.includes('filename="model.obj"') && body.includes("models/model.obj") && body.includes("fixture-head") });
        return;
      }
      default: json(res, { error: { code: "not_found", message: "Fixture not found" } }, 404);
    }
  });
  await listen(primary);
  return {
    origin: `http://127.0.0.1:${primary.address().port}`, externalOrigin, requests,
    reset() { requests.length = 0; counts.clear(); },
    async close() { for (const server of [primary, external]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServers({ port: 18650, externalPort: 18651 });
}
