# Sculptary TypeScript SDK

Client for the [Sculptary](https://sculptary.com) API. No runtime dependencies; works in browsers,
Node 20+ and edge runtimes.

Version 0.2 adds collections, spatial PR comments and surface deviation comparisons.

```bash
npm install github:Sculptary/sdk-typescript
```

```ts
import { Sculptary } from "@sculptary/sdk";

const sdb = new Sculptary({ token: process.env.SCULPTARY_TOKEN });

const repo = await sdb.repos.create({ name: "castle-kit", private: true, topics: ["medieval"] });
await sdb.contents.upload(repo.full_name, { "models/castle.glb": await (await fetch(url)).blob() }, { message: "Add castle" });

const asset = await sdb.assets.waitFor(repo.full_name, "models/castle.glb");
console.log(asset.status, asset.metadata.triangle_count);
```

Uploads become real Git commits; model files are stored with Git LFS. Failed requests throw
`SculptaryError` with `status`, `code` and `message`.

```ts
await sdb.collections.create({ name: "Castle kits", owner: "northwind", slug: "castle-kits" });
await sdb.collections.addItem("northwind/castle-kits", repo.full_name, "Use the tower");
await sdb.collections.reorder("northwind/castle-kits", [repo.full_name]);
const collections = await sdb.collections.listFor("northwind"); // user or organization

const comment = await sdb.pulls.comment(repo.full_name, 1, "Round this edge", {
  path: "models/castle.glb",
  spatialAnchor: { point: [1, 2, 3], normal: [0, 1, 0], camera: { position: [4, 5, 6], target: [1, 2, 3], zoom: 1 } },
});
const comments = await sdb.pulls.comments(repo.full_name, 1);
await sdb.pulls.reply(repo.full_name, 1, comment.id, "Fixed");
await sdb.pulls.resolve(repo.full_name, comment.id);
await sdb.pulls.unresolve(repo.full_name, comment.id);

const metadata = await sdb.assets.compare(repo.full_name, "models/castle.glb", "v1.0.0", "main");
const deviation = await sdb.assets.geometryCompare(repo.full_name, "models/castle.glb", "v1.0.0", "main");
console.log(metadata.diff, deviation.status, deviation.result.hausdorff);
```

Collections also support `get`, `update`, `delete`, `removeItem` and `containing(repository)`.
Use `owner/slug` for a collection and `owner/repository` for an item. Lists are unpaginated; detail
includes visible items, notes and positions. Reordering requires every visible repository exactly
once. Omitted/null notes preserve their current value; `""` clears them. Updates preserve omitted
fields; `{ description: "" }` clears the description.

Exported models include `Collection`, `Comment`, `SpatialAnchor`, `CameraPose`, `AssetComparison` and
`GeometryComparison`. Spatial anchors use `point`; the comment's `path` identifies the asset. Version
0.3 uses real replies through `parent_id` (`parentId` in comment options). Reply to a root comment;
threads support one level of replies. PR detail contains root comments with nested `replies`,
`resolved_at` and `resolved_by`. The comment author, PR author and repository writers can resolve or
reopen a thread. Replies share the root's pin.

Both comparison methods accept a final `{ basePath }` option for renamed models. Added/removed models
can have null sides and a null metadata diff. Deviation may be `waiting`, `pending`, `running`, `ready`
or `failed`; call again while processing. Measurements include `method`, `confidence`, `resolution`
and `hausdorff` (largest change in model units). Non-comparable/failed results include `reason` or
`error`. Heatmap data consists of the scale in `result.heatmap` and an authenticated GLB URL in
`heatmap_url`, rather than an inline array. Unknown server fields are preserved.

Run `pnpm test`, `pnpm typecheck` and `pnpm build`. Tests use mocked fetch; live read-only tests are
opt-in through `SCULPTARY_TEST_HOST`.

Licensed under MIT or Apache-2.0, at your option.
