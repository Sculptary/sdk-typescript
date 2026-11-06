# ShapesDB TypeScript SDK

Client for the [ShapesDB](https://shapesdb.com) API. No runtime dependencies; works in browsers,
Node 20+ and edge runtimes.

```bash
npm install github:ShapesDB/sdk-typescript
```

```ts
import { ShapesDB } from "@shapesdb/sdk";

const sdb = new ShapesDB({ token: process.env.SHAPESDB_TOKEN });

const repo = await sdb.repos.create({ name: "castle-kit", private: true, topics: ["medieval"] });
await sdb.contents.upload(repo.full_name, { "models/castle.glb": await (await fetch(url)).blob() }, { message: "Add castle" });

const asset = await sdb.assets.waitFor(repo.full_name, "models/castle.glb");
console.log(asset.status, asset.metadata.triangle_count);
```

Uploads become real Git commits; model files are stored with Git LFS. Failed requests throw
`ShapesDBError` with `status`, `code` and `message`.

Licensed under MIT or Apache-2.0, at your option.
