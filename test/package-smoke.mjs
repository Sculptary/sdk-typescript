import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const folder = mkdtempSync(join(tmpdir(), "sculptary-sdk-package-"));
const cli = process.env.npm_execpath;
assert.ok(cli, "Run through pnpm test:package");
const pnpm = (args, cwd) => execFileSync(process.execPath, [cli, ...args], { cwd, stdio: "pipe" });
try {
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pnpm(["pack", "--pack-destination", folder], root);
  const tarball = join(folder, `sculptary-sdk-${metadata.version}.tgz`);
  writeFileSync(join(folder, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "@sculptary/sdk": `file:${tarball.replaceAll("\\", "/")}` } }));
  pnpm(["install", "--offline", "--ignore-scripts"], folder);
  const installed = join(folder, "node_modules/@sculptary/sdk");
  assert.match(readFileSync(join(installed, "LICENSE-MIT"), "utf8"), /Permission is hereby granted/);
  assert.match(readFileSync(join(installed, "LICENSE-APACHE"), "utf8"), /Apache License/);
  const packed = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(packed.version, metadata.version);
  assert.equal(Object.keys(packed.dependencies ?? {}).length, 0);
  const consumer = `
import assert from 'node:assert/strict';
import {Sculptary,SculptaryError} from '@sculptary/sdk';
let attempts = 0;
const client = new Sculptary({host:'https://fixture.invalid',retryBaseDelayMs:0,fetch:async()=>++attempts===1?new Response(null,{status:503}):new Response('[{"full_name":"a/b"}]',{headers:{'X-Has-More':'false'}})});
const names = []; for await (const repo of client.repos.iterMine()) names.push(repo.full_name);
assert.deepEqual(names,['a/b']); assert.equal(attempts,2);
assert.ok(new SculptaryError(404,'not_found','Missing') instanceof Error);
`;
  writeFileSync(join(folder, "consumer.mjs"), consumer);
  execFileSync(process.execPath, ["consumer.mjs"], { cwd: folder, stdio: "pipe" });
  writeFileSync(join(folder, "consumer.mts"), `
import { Sculptary, type PaginationOptions, type RetryOptions } from '@sculptary/sdk';
const retry: RetryOptions = {maxRetries:2};
const client = new Sculptary(retry);
const options: PaginationOptions = {perPage:50,key:null,signal:new AbortController().signal};
for await (const repo of client.repos.iterMine(options)) repo.full_name.toUpperCase();
for await (const item of client.paginate<{id:string}>('/example',options)) item.id.toUpperCase();
`);
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM", "consumer.mts"], { cwd: folder, stdio: "pipe" });
  console.log("Packed SDK licence texts, installed ESM imports, retries, iteration and NodeNext declarations pass.");
} finally {
  const resolved = realpathSync(folder);
  assert.ok(resolved.startsWith(realpathSync(tmpdir()) + sep) && dirname(resolved) === realpathSync(tmpdir()));
  rmSync(resolved, { recursive: true, force: true });
}
