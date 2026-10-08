import {approve,restoreInput} from "./approval-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
import { Interface } from "ethers";
import {
  createStore,
  parseFiles,
  zipFiles,
  verifyReceipt,
  MAX_BYTES,
} from "../server/core.mjs";
import { registrySteps, CHAIN } from "../server/chain.mjs";
import { privateIp } from "../server/providers.mjs";

const files = (html, extra = []) => ({
  files: [
    { path: "index.html", base64: Buffer.from(html).toString("base64") },
    ...extra,
  ],
});
const setup = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deweb-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createStore(dir);
};

test("rejects unsafe paths, duplicate entries, server runtimes and leaked secrets", () => {
  for (const name of [
    "../bad",
    "/index.html",
    ".env",
    "assets/../x.js",
    "a\\b",
    "a%2fb",
    "_worker.js",
    "functions/api.js",
    "_headers",
  ])
    assert.throws(() =>
      parseFiles(files("ok", [{ path: name, base64: "eA==" }])),
    );
  assert.throws(
    () => parseFiles(files("ok", [{ path: "index.html", base64: "eA==" }])),
    /重复/,
  );
  assert.throws(
    () =>
      parseFiles(files('const key = "sb_secret_this-is-not-for-a-website"')),
    /秘密/,
  );
  assert.throws(
    () => parseFiles(files("postgres://admin:password@db.internal/database")),
    /秘密/,
  );
  assert.throws(() => parseFiles(files("x".repeat(MAX_BYTES + 1))), /10 MiB/);
  assert.throws(
    () => parseFiles({ files: [{ path: "app.js", base64: "eA==" }] }),
    /index.html/,
  );
});

test("ZIP root stripping and deterministic manifests preserve exact bytes", () => {
  const archive = zipSync({
    "dist/index.html": Buffer.from("<h1>Hello</h1>"),
    "dist/assets/main.js": Buffer.from("globalThis.ok=1"),
  });
  const artifact = zipFiles(archive);
  assert.equal(artifact.files.length, 2);
  assert.equal(artifact.files[0].path, "assets/main.js");
  const again = parseFiles({ files: [...artifact.files].reverse() });
  assert.equal(again.manifestHash, artifact.manifestHash);
  assert.throws(
    () => zipFiles(zipSync({ "../index.html": Buffer.from("x") })),
    /越界/,
  );
});

test("history restores exact artifacts without touching database connections", (t) => {
  const s = setup(t),
    p = s.createProject("test-project");
  const r1 = s.createRelease(p.id, parseFiles(files("v1"))),
    r2 = s.createRelease(p.id, parseFiles(files("v2")));
  s.state.connections[p.id + ":supabase:preview"] = {
    provider: "supabase",
    secrets: s.encrypt({ key: "example-public-key" }),
  };
  approve(s,r1);approve(s,r2);
  s.promote(p.id, r1.id);
  s.promote(p.id, r2.id);
  assert.equal(r1.environment, "preview");
  assert.equal(p.productionId, r2.id);
  const before = JSON.stringify(s.state.connections),
    restore = s.restore(p.id, r1.id,restoreInput(s,r1));
  assert.notEqual(restore.id, r1.id);
  assert.equal(restore.manifestHash, r1.manifestHash);
  assert.equal(s.state.releases.length, 3);
  assert.equal(p.productionId, r2.id);
  approve(s,restore);s.promote(p.id,restore.id);
  assert.equal(p.productionId,restore.id);
  assert.equal(JSON.stringify(s.state.connections), before);
  assert.equal(r2.environment, "preview");
  assert.equal(restore.chainStatus, "not_published");
  assert.equal(restore.restoredFrom,r1.id);assert.ok(restore.receipt.payload.configurationDigest);
});

test("signed export independently verifies and detects archive/receipt tampering", (t) => {
  const s = setup(t),
    p = s.createProject("export-demo"),
    r = s.createRelease(p.id, parseFiles(files("signed bytes")));
  approve(s,r);
  s.promote(p.id, r.id);
  assert.equal(verifyReceipt(r.receipt), true);
  const exported = unzipSync(s.exportRelease(r.id)),
    receipt = JSON.parse(Buffer.from(exported["release.json"]));
  assert.equal(
    Buffer.from(exported["site/index.html"]).toString(),
    "signed bytes",
  );
  assert.equal(verifyReceipt(receipt), true);
  receipt.payload.manifestHash = "tampered";
  assert.equal(verifyReceipt(receipt), false);
  r.files[0].base64 = Buffer.from("changed").toString("base64");
  assert.throws(() => s.exportRelease(r.id), /清单/);
  assert.throws(() => s.promote(p.id, r.id), /清单/);
});

test("encrypted credentials never appear in state API and project boundaries hold", (t) => {
  const s = setup(t),
    p = s.createProject("one"),
    other = s.createProject("two"),
    r = s.createRelease(p.id, parseFiles(files("one")));
  const secret = { token: "secret-fixture-not-a-real-token" };
  const encrypted = s.encrypt(secret);
  assert.deepEqual(s.decrypt(encrypted), secret);
  s.state.connections.test = {
    provider: "cloudflare",
    projectId: p.id,
    secrets: encrypted,
  };
  assert.ok(!JSON.stringify(s.publicState()).includes(secret.token));
  assert.ok(!JSON.stringify(s.publicState()).includes(encrypted.data));
  assert.throws(() => s.promote(other.id, r.id), /不属于/);
  assert.throws(() => s.restore(other.id, r.id), /不属于/);
  const damaged = { ...encrypted, tag: "00".repeat(16) };
  assert.throws(() => s.decrypt(damaged));
});

test("chunked publishing encodes precise bytes, indices and destination", () => {
  const data = Buffer.alloc(48001, 42),
    artifact = parseFiles(
      files("index", [
        { path: "payload.bin", base64: data.toString("base64") },
      ]),
    );
  const steps = registrySteps(
    "0x0000000000000000000000000000000000000001",
    artifact.files,
  );
  const parts = steps.filter((s) => s.path === "payload.bin");
  assert.equal(parts.length, 3);
  assert.deepEqual(
    parts.map((x) => x.kind),
    ["putFile", "appendChunk", "appendChunk"],
  );
  const abi = new Interface([
    "function putFile(address,string,string,bytes32,bytes)",
    "function appendChunk(address,string,uint256,bytes)",
  ]);
  const recovered = parts.map((p, i) => {
    assert.equal(p.to, CHAIN.registry);
    const parsed = abi.parseTransaction({ data: p.data });
    if (i) assert.equal(Number(parsed.args[2]), i);
    return Buffer.from(parsed.args[i ? 3 : 4].slice(2), "hex");
  });
  assert.deepEqual(Buffer.concat(recovered), data);
});

test("obsolete paths are removed only after the new files and fallback", () => {
  const container = "0x0000000000000000000000000000000000000001",
    artifact = parseFiles(
      files("index", [{ path: "app.js", base64: Buffer.from("v2").toString("base64") }]),
    );
  const steps = registrySteps(container, artifact.files, CHAIN, ["old.js", "old.css"]);
  const kinds = steps.map((s) => s.kind),
    fallback = kinds.indexOf("setFallback");
  assert.ok(fallback > kinds.lastIndexOf("putFile"));
  assert.deepEqual(kinds.slice(fallback + 1), ["removeFile", "removeFile"]);
  const abi = new Interface(["function removeFile(address,string)"]);
  assert.deepEqual(
    steps.slice(fallback + 1).map((s) => {
      assert.equal(s.to, CHAIN.registry);
      return [s.path, abi.parseTransaction({ data: s.data }).args[1]];
    }),
    [["old.js", "old.js"], ["old.css", "old.css"]],
  );
  assert.ok(!registrySteps(container, artifact.files).some((s) => s.kind === "removeFile"));
});

test("private, link-local and metadata destinations are classified as unsafe", () => {
  for (const host of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.18.0.1",
    "192.168.1.1",
    "100.64.1.2",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(privateIp(host), true, host);
  assert.equal(privateIp("1.1.1.1"), false);
  assert.equal(privateIp("8.8.8.8"), false);
});
