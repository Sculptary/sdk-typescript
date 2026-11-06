/**
 * ShapesDB TypeScript SDK. Works in browsers, Node 18+ and edge runtimes (uses fetch).
 *
 *   const sdb = new ShapesDB({ token: process.env.SHAPESDB_TOKEN });
 *   const repo = await sdb.repos.get("northwind/medieval-castle");
 */

export const DEFAULT_HOST = "https://shapesdb.com";

export class ShapesDBError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "ShapesDBError";
  }
}

export interface Owner {
  slug: string;
  kind: "user" | "organization";
  display_name: string;
  avatar_url: string;
}

export interface Repository {
  id: string;
  owner: Owner;
  name: string;
  full_name: string;
  description: string;
  visibility: "public" | "private";
  default_branch: string;
  license: string;
  topics: string[];
  formats: string[];
  max_triangles: number | null;
  is_empty: boolean;
  star_count: number;
  fork_count: number;
  clone_http: string;
  clone_ssh: string;
  thumbnail_url: string | null;
  pushed_at: string | null;
  [key: string]: unknown;
}

export interface AssetMetadata {
  vertex_count?: number;
  triangle_count?: number;
  mesh_count?: number;
  material_count?: number;
  texture_count?: number;
  animation_count?: number;
  bounding_box?: { min: number[]; max: number[]; size: number[]; center: number[] } | null;
  [key: string]: unknown;
}

export interface Asset {
  id: string;
  path: string;
  commit: string;
  format: string;
  size: number;
  status: "pending" | "processing" | "ready" | "failed" | "unsupported" | "missing_content";
  lfs: boolean;
  metadata: AssetMetadata;
  warnings: string[];
  preview_url: string | null;
  thumbnail_url: string | null;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "blob" | "tree" | "commit";
  oid: string;
  size: number | null;
  model_format: string | null;
}

export interface Branch {
  name: string;
  commit: string;
  protected: boolean;
  default: boolean;
}

export interface Commit {
  oid: string;
  parents: string[];
  message: string;
  author: { name: string; email: string; date: string; username?: string | null };
  committer: { name: string; email: string; date: string };
}

export interface ClientOptions {
  token?: string;
  host?: string;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class ShapesDB {
  readonly host: string;
  private token?: string;
  private fetcher: typeof fetch;

  readonly repos = new Repos(this);
  readonly contents = new Contents(this);
  readonly assets = new Assets(this);
  readonly releases = new Releases(this);
  readonly pulls = new Pulls(this);
  readonly issues = new Issues(this);

  constructor(options: ClientOptions = {}) {
    this.host = (options.host ?? DEFAULT_HOST).replace(/\/+$/, "");
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  url(path: string, query?: Query): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    const s = q.toString();
    return `${this.host}/api/v1${path}${s ? `?${s}` : ""}`;
  }

  async raw(method: string, path: string, init: { query?: Query; json?: unknown; body?: BodyInit; redirect?: RequestRedirect } = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const res = await this.fetcher(this.url(path, init.query), { method, headers, body, redirect: init.redirect ?? "follow" });
    if (!res.ok) {
      let err: { code?: string; message?: string; field?: string } = {};
      try {
        err = ((await res.json()) as { error?: typeof err }).error ?? {};
      } catch {
        /* non-JSON error */
      }
      throw new ShapesDBError(res.status, err.code ?? "error", err.message ?? `Request failed (${res.status})`, err.field);
    }
    return res;
  }

  async request<T>(method: string, path: string, init: { query?: Query; json?: unknown; body?: BodyInit } = {}): Promise<T> {
    const res = await this.raw(method, path, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  me() {
    return this.request<{ id: string; username: string; email: string }>("GET", "/user");
  }

  async search(q = "", filters: Query = {}): Promise<{ total: number; items: Repository[] }> {
    return this.request("GET", "/search/repositories", { query: { q, ...filters } });
  }
}

class Resource {
  constructor(protected c: ShapesDB) {}
}

class Repos extends Resource {
  get(fullName: string) {
    return this.c.request<Repository>("GET", `/repos/${fullName}`);
  }
  mine() {
    return this.c.request<Repository[]>("GET", "/user/repos");
  }
  listFor(owner: string) {
    return this.c.request<Repository[]>("GET", `/users/${owner}/repos`);
  }
  create(input: { name: string; owner?: string; private?: boolean; description?: string; license?: string; topics?: string[]; initializeReadme?: boolean }) {
    return this.c.request<Repository>("POST", "/repos", {
      json: {
        name: input.name, owner: input.owner, visibility: input.private ? "private" : "public", description: input.description ?? "",
        license: input.license ?? "", topics: input.topics ?? [], initialize_readme: input.initializeReadme ?? false,
      },
    });
  }
  update(fullName: string, fields: Partial<Pick<Repository, "description" | "license" | "topics" | "visibility" | "default_branch">> & { name?: string }) {
    return this.c.request<Repository>("PATCH", `/repos/${fullName}`, { json: fields });
  }
  delete(fullName: string) {
    return this.c.request<void>("DELETE", `/repos/${fullName}`);
  }
  fork(fullName: string, options: { owner?: string; name?: string } = {}) {
    return this.c.request<Repository>("POST", `/repos/${fullName}/forks`, { json: options });
  }
  branches(fullName: string) {
    return this.c.request<Branch[]>("GET", `/repos/${fullName}/branches`);
  }
  async commits(fullName: string, options: { ref?: string; path?: string; page?: number } = {}) {
    return (await this.c.request<{ commits: Commit[] }>("GET", `/repos/${fullName}/commits`, { query: options })).commits;
  }
  compare(fullName: string, base: string, head: string) {
    return this.c.request<{ commits: Commit[]; changes: unknown[]; mergeable: boolean }>("GET", `/repos/${fullName}/compare`, { query: { base, head } });
  }
  star(fullName: string) {
    return this.c.request<void>("PUT", `/user/starred/${fullName}`);
  }
}

class Contents extends Resource {
  async tree(fullName: string, path = "", ref?: string) {
    return (await this.c.request<{ entries: TreeEntry[] }>("GET", `/repos/${fullName}/tree`, { query: { path, ref } })).entries;
  }
  async readText(fullName: string, path: string, ref?: string): Promise<string> {
    const blob = await this.c.request<{ content: string | null }>("GET", `/repos/${fullName}/blob`, { query: { path, ref } });
    if (blob.content === null) throw new ShapesDBError(422, "binary", `${path} is binary; use download()`);
    return blob.content;
  }
  /** File bytes (LFS content resolved). */
  async download(fullName: string, path: string, ref?: string): Promise<ArrayBuffer> {
    const res = await this.c.raw("GET", `/repos/${fullName}/raw`, { query: { path, ref, download: true } });
    return res.arrayBuffer();
  }
  /** Commit files in one commit. Keys are repository paths. Model files are stored with Git LFS. */
  async upload(fullName: string, files: Record<string, Blob | ArrayBuffer | Uint8Array | string>, options: { message: string; branch?: string; expectedHead?: string; newBranch?: string }) {
    const branch = options.branch ?? (await this.c.repos.get(fullName)).default_branch;
    const expectedHead = options.expectedHead ?? (await this.c.repos.branches(fullName)).find((b) => b.name === branch)?.commit ?? "";
    const form = new FormData();
    form.set("branch", branch);
    form.set("message", options.message);
    form.set("expected_head", expectedHead);
    if (options.newBranch) form.set("new_branch", options.newBranch);
    for (const [path, data] of Object.entries(files)) {
      const blob = data instanceof Blob ? data : new Blob([typeof data === "string" ? data : (data as BlobPart)]);
      form.append("paths", path);
      form.append("files", blob, path.split("/").pop());
    }
    return this.c.request<{ commit: string; ref: string }>("POST", `/repos/${fullName}/contents`, { body: form });
  }
}

class Assets extends Resource {
  async list(fullName: string, ref?: string) {
    return (await this.c.request<{ commit: string; assets: Asset[] }>("GET", `/repos/${fullName}/assets`, { query: { ref } })).assets;
  }
  get(fullName: string, path: string, ref?: string) {
    return this.c.request<Asset>("GET", `/repos/${fullName}/asset`, { query: { path, ref } });
  }
  /** Poll until processing finishes (ready, failed, unsupported or missing content). */
  async waitFor(fullName: string, path: string, options: { ref?: string; timeoutMs?: number; intervalMs?: number } = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    for (;;) {
      const a = await this.get(fullName, path, options.ref);
      if (!["pending", "processing"].includes(a.status) || Date.now() > deadline) return a;
      await new Promise((r) => setTimeout(r, options.intervalMs ?? 2000));
    }
  }
  compare(fullName: string, path: string, base: string, head: string) {
    return this.c.request<unknown>("GET", `/repos/${fullName}/asset-compare`, { query: { path, base, head } });
  }
  formats() {
    return this.c.request<{ key: string; name: string; status: string }[]>("GET", "/formats");
  }
}

class Releases extends Resource {
  list(fullName: string) {
    return this.c.request<unknown[]>("GET", `/repos/${fullName}/releases`);
  }
  create(fullName: string, tag: string, options: { name?: string; body?: string; target?: string; prerelease?: boolean; draft?: boolean } = {}) {
    return this.c.request<{ tag_name: string; target_commit: string }>("POST", `/repos/${fullName}/releases`, { json: { tag_name: tag, ...options } });
  }
}

class Pulls extends Resource {
  async list(fullName: string, state: "open" | "closed" | "merged" = "open") {
    return (await this.c.request<{ items: unknown[] }>("GET", `/repos/${fullName}/pulls`, { query: { state } })).items;
  }
  create(fullName: string, input: { title: string; sourceBranch: string; targetBranch?: string; body?: string; sourceRepository?: string }) {
    return this.c.request<{ number: number }>("POST", `/repos/${fullName}/pulls`, {
      json: { title: input.title, body: input.body ?? "", source_branch: input.sourceBranch, target_branch: input.targetBranch, source_repository: input.sourceRepository },
    });
  }
  merge(fullName: string, number: number, strategy: "merge" | "squash" = "merge") {
    return this.c.request<{ state: string }>("POST", `/repos/${fullName}/pulls/${number}/merge`, { json: { strategy } });
  }
}

class Issues extends Resource {
  async list(fullName: string, state: "open" | "closed" = "open") {
    return (await this.c.request<{ items: unknown[] }>("GET", `/repos/${fullName}/issues`, { query: { state } })).items;
  }
  create(fullName: string, title: string, body = "") {
    return this.c.request<{ number: number }>("POST", `/repos/${fullName}/issues`, { json: { title, body } });
  }
}
