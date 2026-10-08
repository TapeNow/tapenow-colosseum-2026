import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import http from "node:http";

// Node fetch normalizes Host; a raw HTTP request exercises virtual hosts.
function hostRequest(url, host) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers: { Host: host } }, (res) => {
        const chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: { get: (key) => res.headers[key.toLowerCase()] },
            text: async () => Buffer.concat(chunks).toString(),
          }),
        );
      })
      .on("error", reject);
  });
}

test("HTTP lifecycle, isolated previews, connection gates and persistence", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deweb-http-"));
  const port = 43811,
    previewPort = 43812,
    url = "http://127.0.0.1:" + port;
  let proc;
  async function start() {
    proc = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEWEB_DATA_DIR: dir,
        PORT: String(port),
        PREVIEW_PORT: String(previewPort),
      },
      stdio: "pipe",
    });
    let log = "";
    proc.stdout.on("data", (b) => (log += b));
    proc.stderr.on("data", (b) => (log += b));
    for (let n = 0; n < 80; n++) {
      try {
        const r = await fetch(url + "/api/session");
        if (r.ok) return (await r.json()).token;
      } catch {}
      if (proc.exitCode !== null) throw Error(log);
      await pause(50);
    }
    throw Error("Server failed to start: " + log);
  }
  async function stop() {
    if (proc?.exitCode === null) {
      proc.kill("SIGTERM");
      await once(proc, "exit");
    }
  }
  t.after(async () => {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let token = await start();
  const call = async (path, body, method) =>
    fetch(url + "/api" + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", "X-Deweb-Token": token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal(
    (
      await fetch(url + "/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/state", {
        headers: { Origin: "https://attacker.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await hostRequest(url + "/api/session", "evil.test")).status,
    403,
  );
  const p = await (await call("/projects", { name: "http-demo" })).json();
  const body = (content) => ({
    label: content,
    files: [
      {
        path: "index.html",
        base64: Buffer.from(
          "<h1>" + content + '</h1><script src="/assets/main.js"></script>',
        ).toString("base64"),
      },
      {
        path: "assets/main.js",
        base64: Buffer.from("window.working=true").toString("base64"),
      },
    ],
  });
  const v1 = await (
      await call("/projects/" + p.id + "/import", body("v1"))
    ).json(),
    v2 = await (await call("/projects/" + p.id + "/import", body("v2"))).json();
  const approve = async (r) => {
    const ready=await (await call('/releases/'+r.id+'/readiness')).json();
    const result=await call('/releases/'+r.id+'/approve',{digest:ready.digest,intent:'cloud',acknowledgeUnknown:true,acknowledgeLegacy:true,acknowledgeRestore:true});
    assert.equal(result.status,200);
  };
  assert.equal((await call('/projects/'+p.id+'/promote',{releaseId:v1.id})).status,409);
  await approve(v1);await approve(v2);
  assert.equal(
    (await call("/projects/" + p.id + "/promote", { releaseId: v2.id })).status,
    200,
  );
  const preview = async (host, resource = "/") =>
    hostRequest(
      "http://127.0.0.1:" + previewPort + resource,
      host + ":" + previewPort,
    );
  const base = p.id + ".localhost",
    isolated = v1.id + "." + base;
  assert.match(await (await preview(base)).text(), /<h1>v2<\/h1>/);
  assert.match(await (await preview(isolated)).text(), /<h1>v1<\/h1>/);
  assert.equal(
    await (await preview(isolated, "/assets/main.js")).text(),
    "window.working=true",
  );
  assert.equal((await preview(isolated, "/client/route")).status, 200);
  assert.equal((await preview("other.localhost")).status, 404);
  assert.match(
    (await preview(isolated, "/api/session")).headers.get("Content-Type"),
    /^text\/html/,
  );
  assert.match(
    (await preview(isolated, "/assets/main.js")).headers.get("cache-control"),
    /immutable/,
  );
  assert.equal(
    (await preview(base, "/assets/main.js")).headers.get("cache-control"),
    "no-store",
  );
  const restored = await (
    await call("/projects/" + p.id + "/restore", { releaseId: v1.id, digest:(await (await call("/releases/"+v1.id+"/restore-check")).json()).digest,acknowledgeUnknown:true })
  ).json();
  assert.notEqual(restored.id, v1.id);
  assert.equal(restored.manifestHash, v1.manifestHash);
  assert.match(await (await preview(base)).text(), /<h1>v2<\/h1>/);
  await approve(restored);
  assert.equal((await call("/projects/"+p.id+"/promote",{releaseId:restored.id})).status,200);
  assert.match(await (await preview(base)).text(), /<h1>v1<\/h1>/);
  assert.equal(
    (
      await call("/releases/" + restored.id + "/cloudflare", {
        production: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/releases/" + restored.id + "/chain/prepare", {
        from: "0x0000000000000000000000000000000000000001",
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/projects/" + p.id + "/domains", { hostname: "not a domain" }))
      .status,
    400,
  );
  const d = await (
    await call("/projects/" + p.id + "/domains", {
      hostname: "demo.example.com",
    })
  ).json();
  assert.equal(d.status, "pending");
  assert.equal((await call("/domains/" + d.id + "/connect", {})).status, 409);
  await call("/projects/" + p.id + "/environment", {
    key: "SERVER_SECRET",
    value: "must-not-be-public",
    environment: "preview",
    secret: true,
  });
  let state = await (await call("/state")).json();
  assert.ok(!JSON.stringify(state).includes("must-not-be-public"));
  await call("/projects/" + p.id + "/environment", {
    key: "SERVER_SECRET",
    value: "replacement",
    environment: "preview",
    secret: true,
  });
  state = await (await call("/state")).json();
  assert.equal(
    Object.values(state.connections).filter((c) => c.provider === "secret")
      .length,
    1,
  );
  assert.equal(
    (await call("/releases/" + restored.id + "/export")).headers.get(
      "content-type",
    ),
    "application/zip",
  );
  assert.equal((await fetch(url + "/docs/supabase-demo.sql")).status, 200);
  await stop();
  token = await start();
  state = await (await call("/state")).json();
  assert.equal(
    state.projects.find((x) => x.id === p.id).productionId,
    restored.id,
  );
  assert.equal(
    state.domains.find((x) => x.id === d.id).hostname,
    "demo.example.com",
  );
});
