/**
 * Sculptary TypeScript SDK. Works in browsers, Node 20+ and edge runtimes (uses fetch).
 *
 *   const sdb = new Sculptary({ token: process.env.SCULPTARY_TOKEN });
 *   const repo = await sdb.repos.get("northwind/medieval-castle");
 */

import { iteratePages, pageSize, type IterationOptions, type PaginationOptions, type Query } from "./pagination.js";
export type { IterationOptions, PaginationOptions, Query } from "./pagination.js";

export const DEFAULT_HOST = "https://sculptary.com";

export class SculptaryError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "SculptaryError";
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

export type Vector3 = [number, number, number];

/** Collection summary. Detail and mutation responses also include ordered items. */
export interface Collection {
  id: string;
  owner: Owner;
  slug: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  viewer_can_manage: boolean;
  items?: CollectionItem[];
  [key: string]: unknown;
}

export interface CollectionItem {
  repository: Repository;
  note: string;
  position: number;
}

export interface CollectionCreate {
  name: string;
  owner?: string;
  slug?: string;
  description?: string;
  visibility?: "public" | "private";
}

export type CollectionUpdate = Partial<Pick<Collection, "name" | "slug" | "description" | "visibility">>;

/** Viewer camera in model coordinates. */
export interface CameraPose {
  position: Vector3;
  target: Vector3;
  zoom: number;
}

/** The asset path is the comment's top-level path field. */
export interface SpatialAnchor {
  point: Vector3;
  normal?: Vector3 | null;
  camera?: CameraPose | null;
  object?: string;
  mesh?: string;
  [key: string]: unknown;
}

export interface UserRef {
  username: string;
  display_name: string;
  avatar_url: string;
}

/** PR comment, optionally pinned to a file, line or model point. */
export interface Comment {
  id: string;
  author: UserRef | null;
  body: string;
  body_html: string;
  path: string | null;
  line: number | null;
  commit_sha: string | null;
  spatial_anchor: SpatialAnchor | null;
  review_id: string | null;
  parent_id: string | null;
  resolved_at: string | null;
  resolved_by: UserRef | null;
  replies: Comment[];
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface CommentOptions {
  parentId?: string;
  path?: string | null;
  line?: number | null;
  commitSha?: string | null;
  spatialAnchor?: SpatialAnchor | null;
}

export interface NumericDelta {
  base: number | null;
  head: number | null;
  delta: number | null;
}

export interface BoundingBox {
  min?: Vector3;
  max?: Vector3;
  size?: Vector3;
  center?: Vector3;
}

export interface MetadataDiff {
  statistics: Record<string, NumericDelta>;
  bounding_box: { base: BoundingBox | null; head: BoundingBox | null; size_changed: boolean };
  materials: { added: string[]; removed: string[] };
}

/** A side or diff may be null for an added or removed model. */
export interface AssetComparison {
  base: Asset | null;
  head: Asset | null;
  status: "added" | "removed" | "modified" | "unchanged";
  diff: MetadataDiff | null;
  [key: string]: unknown;
}

/** Colour scale of the GLB at heatmap_url, in model units. */
export interface Heatmap {
  scale_min: number;
  scale_max: number;
  unit: string;
  [key: string]: unknown;
}

/** Fields may be absent while running, or for failed/non-comparable models. */
export interface DeviationSummary {
  comparable?: boolean;
  identical?: boolean;
  method?: string;
  approximate?: boolean;
  /** Largest surface change in model units. */
  hausdorff?: number;
  mean_deviation?: number;
  rms_deviation?: number;
  tolerance?: number;
  resolution?: number;
  confidence?: "high" | "medium" | "low";
  removed_surface_percent?: number;
  added_surface_percent?: number;
  area?: { base: number | null; head: number | null };
  volume?: { base: number | null; head: number | null };
  topology?: { base: { vertices: number; faces: number; euler: number }; head: { vertices: number; faces: number; euler: number } };
  heatmap?: Heatmap;
  notes?: string[];
  reason?: string;
  error?: string;
  [key: string]: unknown;
}

export interface GeometryComparison {
  id: string | null;
  status: "waiting" | "pending" | "running" | "ready" | "failed";
  result: DeviationSummary;
  heatmap_url: string | null;
  heatmap_status: "pending" | "ready" | "failed" | "unavailable";
  [key: string]: unknown;
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

export interface RequestOptions { query?: Query; json?: unknown; body?: BodyInit; redirect?: RequestRedirect; signal?: AbortSignal }

export class Sculptary {
  readonly host: string;
  private token?: string;
  private fetcher: typeof fetch;

  readonly repos = new Repos(this);
  readonly contents = new Contents(this);
  readonly assets = new Assets(this);
  readonly releases = new Releases(this);
  readonly pulls = new Pulls(this);
  readonly issues = new Issues(this);
  readonly collections = new Collections(this);

  constructor(options: ClientOptions = {}) {
    this.host = (options.host ?? DEFAULT_HOST).replace(/\/+$/, "");
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  url(path: string, query?: Query): string {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `${this.host}/api/v1${path}`);
    if (url.origin !== new URL(this.host).origin || url.username || url.password) throw new TypeError("API requests must use the configured host.");
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    return url.href;
  }

  async raw(method: string, path: string, init: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const res = await this.fetcher(this.url(path, init.query), { method, headers, body, redirect: init.redirect ?? "follow", signal: init.signal });
    if (!res.ok) {
      let err: { code?: string; message?: string; field?: string } = {};
      try {
        err = ((await res.json()) as { error?: typeof err }).error ?? {};
      } catch {
        /* non-JSON error */
      }
      throw new SculptaryError(res.status, err.code ?? "error", err.message ?? `Request failed (${res.status})`, err.field);
    }
    return res;
  }

  async request<T>(method: string, path: string, init: RequestOptions = {}): Promise<T> {
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

  /** Lazy pages. key: null selects an array response; the default key is items. */
  async *paginate<T>(path: string, options: PaginationOptions = {}): AsyncGenerator<T> {
    yield* iteratePages<T>(new URL(this.url(path, options.query)), url => this.raw("GET", url, { signal: options.signal }), options);
  }

  async *iterSearch(q = "", filters: Query = {}, options: IterationOptions = {}): AsyncGenerator<Repository> {
    yield* this.paginate<Repository>("/search/repositories", { ...options, perPage: pageSize(options, 50), query: { q, ...filters } });
  }
}

class Resource {
  constructor(protected c: Sculptary) {}
}

class Repos extends Resource {
  iterMine(options: IterationOptions = {}) { return this.c.paginate<Repository>("/user/repos", { ...options, key: null }); }
  iterFor(owner: string, options: IterationOptions = {}) { return this.c.paginate<Repository>(`/users/${owner}/repos`, { ...options, key: null }); }
  async *iterBranches(fullName: string) { yield* await this.branches(fullName); }
  async *iterCommits(fullName: string, filters: { ref?: string; path?: string } = {}, options: IterationOptions = {}) {
    yield* this.c.paginate<Commit>(`/repos/${fullName}/commits`, { ...options, perPage: pageSize(options, 100), key: "commits", query: filters });
  }
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

/** Curated repositories owned by a user or organization (owner/slug). */
class Collections extends Resource {
  async *iterFor(owner: string) { yield* await this.listFor(owner); }
  async *iterContaining(repository: string) { yield* await this.containing(repository); }
  /** All visible collections for a user or organization; no pagination. */
  listFor(owner: string) {
    return this.c.request<Collection[]>("GET", `/users/${owner}/collections`);
  }
  /** Collection detail including visible items, notes and positions. */
  get(fullName: string) {
    return this.c.request<Collection>("GET", `/collections/${fullName}`);
  }
  /** Omit owner to use the signed-in user's namespace. */
  create(input: CollectionCreate) {
    return this.c.request<Collection>("POST", "/collections", {
      json: { name: input.name, owner: input.owner, slug: input.slug, description: input.description ?? "", visibility: input.visibility ?? "public" },
    });
  }
  /** Update supplied fields; an empty description clears it. */
  update(fullName: string, fields: CollectionUpdate) {
    return this.c.request<Collection>("PATCH", `/collections/${fullName}`, { json: fields });
  }
  /** Delete the collection, leaving its repositories intact. */
  delete(fullName: string) {
    return this.c.request<void>("DELETE", `/collections/${fullName}`);
  }
  /** Add owner/repo or update its note. Omitted/null preserves a note; "" clears it. */
  addItem(fullName: string, repository: string, note?: string | null) {
    return this.c.request<Collection>("PUT", `/collections/${fullName}/items/${repository}`, { json: { note: note ?? null } });
  }
  /** Remove a repository from the collection. */
  removeItem(fullName: string, repository: string) {
    return this.c.request<void>("DELETE", `/collections/${fullName}/items/${repository}`);
  }
  /** Supply every visible repository exactly once, in the desired order. */
  reorder(fullName: string, fullNames: string[]) {
    return this.c.request<Collection>("POST", `/collections/${fullName}/order`, { json: { full_names: fullNames } });
  }
  /** All visible collections containing owner/repo; no pagination. */
  containing(repository: string) {
    return this.c.request<Collection[]>("GET", `/repos/${repository}/collections`);
  }
}

class Contents extends Resource {
  async *iterTree(fullName: string, path = "", ref?: string) { yield* await this.tree(fullName, path, ref); }
  async tree(fullName: string, path = "", ref?: string) {
    return (await this.c.request<{ entries: TreeEntry[] }>("GET", `/repos/${fullName}/tree`, { query: { path, ref } })).entries;
  }
  async readText(fullName: string, path: string, ref?: string): Promise<string> {
    const blob = await this.c.request<{ content: string | null }>("GET", `/repos/${fullName}/blob`, { query: { path, ref } });
    if (blob.content === null) throw new SculptaryError(422, "binary", `${path} is binary; use download()`);
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
  async *iter(fullName: string, ref?: string) { yield* await this.list(fullName, ref); }
  async *iterFormats() { yield* await this.formats(); }
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
  /** Compare model metadata between refs; basePath supports renamed files. */
  compare(fullName: string, path: string, base: string, head: string, options: { basePath?: string } = {}) {
    return this.c.request<AssetComparison>("GET", `/repos/${fullName}/asset-compare`, { query: { path, base, head, base_path: options.basePath } });
  }
  /** Get or start a deviation comparison. Call again while waiting/pending/running.
   * Includes accuracy information, heatmap scale and an authenticated heatmap GLB URL.
   */
  geometryCompare(fullName: string, path: string, base: string, head: string, options: { basePath?: string } = {}) {
    return this.c.request<GeometryComparison>("GET", `/repos/${fullName}/geometry-compare`, { query: { path, base, head, base_path: options.basePath } });
  }
  formats() {
    return this.c.request<{ key: string; name: string; status: string }[]>("GET", "/formats");
  }
}

class Releases extends Resource {
  async *iter(fullName: string, options: IterationOptions = {}) {
    yield* this.c.paginate<unknown>(`/repos/${fullName}/releases`, { ...options, perPage: pageSize(options, 100), key: null });
  }
  list(fullName: string) {
    return this.c.request<unknown[]>("GET", `/repos/${fullName}/releases`);
  }
  create(fullName: string, tag: string, options: { name?: string; body?: string; target?: string; prerelease?: boolean; draft?: boolean } = {}) {
    return this.c.request<{ tag_name: string; target_commit: string }>("POST", `/repos/${fullName}/releases`, { json: { tag_name: tag, ...options } });
  }
}

class Pulls extends Resource {
  async *iter(fullName: string, state: "open" | "closed" | "merged" = "open", options: IterationOptions & { filters?: Query } = {}) {
    yield* this.c.paginate<unknown>(`/repos/${fullName}/pulls`, { ...options, perPage: pageSize(options, 100), query: { state, ...options.filters } });
  }
  async *iterComments(fullName: string, number: number) { yield* await this.comments(fullName, number); }
  /** All PR comments including spatial anchors, via PR detail; no pagination. */
  async comments(fullName: string, number: number) {
    return (await this.c.request<{ comments: Comment[] }>("GET", `/repos/${fullName}/pulls/${number}`)).comments;
  }
  /** Create a comment. Model anchors use point/normal/camera; path identifies the asset. */
  comment(fullName: string, number: number, body: string, options: CommentOptions = {}) {
    return this.c.request<Comment>("POST", `/repos/${fullName}/pulls/${number}/comments`, {
      json: options.parentId !== undefined ? { body, parent_id: options.parentId } : { body, path: options.path, line: options.line, commit_sha: options.commitSha, spatial_anchor: options.spatialAnchor },
    });
  }
  /** Reply to a root comment. The API validates the parent and thread depth. */
  reply(fullName: string, number: number, commentId: string, body: string) {
    return this.comment(fullName, number, body, { parentId: commentId });
  }
  /** Resolve a thread as its author, the PR author or a repository writer. */
  resolve(fullName: string, commentId: string) {
    return this.c.request<Comment>("POST", `/repos/${fullName}/comments/${commentId}/resolve`, { json: {} });
  }
  /** Reopen a resolved thread. */
  unresolve(fullName: string, commentId: string) {
    return this.c.request<Comment>("POST", `/repos/${fullName}/comments/${commentId}/unresolve`, { json: {} });
  }
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
  async *iter(fullName: string, state: "open" | "closed" = "open", options: IterationOptions & { filters?: Query } = {}) {
    yield* this.c.paginate<unknown>(`/repos/${fullName}/issues`, { ...options, perPage: pageSize(options, 100), query: { state, ...options.filters } });
  }
  async list(fullName: string, state: "open" | "closed" = "open") {
    return (await this.c.request<{ items: unknown[] }>("GET", `/repos/${fullName}/issues`, { query: { state } })).items;
  }
  create(fullName: string, title: string, body = "") {
    return this.c.request<{ number: number }>("POST", `/repos/${fullName}/issues`, { json: { title, body } });
  }
}
