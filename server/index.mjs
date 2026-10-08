import {mountCfDomainRoutes} from './cf-domains.mjs';
import {mountGatewayRoutes} from './gateway-routes.mjs';
import {mountP0DataRoutes} from './p0-data-routes.mjs';
import {mountEcosystemRoutes} from './ecosystem-routes.mjs';
import {CHAINS} from './chains.mjs';
import {mountBatch2Routes} from "./batch2-routes.mjs";
import {mountRuntimeRoutes} from "./runtime.mjs";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  createStore,
  parseFiles,
  zipFiles,
  demand,
  id,
  now,
  sha,
} from "./core.mjs";
import { checkConnection, deployCloudflare, cfRequest } from "./providers.mjs";
import {
  CHAIN,
  prepareChain,
  confirmTransaction,
  readback,
  preflightStep,
  prepareActivation,
} from "./chain.mjs";
import { sampleFiles } from "./sample.mjs";
import { createOAuthService, mountOAuthRoutes } from "./oauth.mjs";
import {mountSourceRoutes} from "./sources.mjs";
import {mountProjectRoutes} from "./routes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (fs.existsSync(path.join(root, ".env")))
  process.loadEnvFile(path.join(root, ".env"));
export const dataDir = process.env.DEWEB_DATA_DIR || path.join(root, ".data");
export const store = createStore(dataDir);
const PORT = Number(process.env.PORT || 4311),
  PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 4312);
const sessionToken = id("session");
const active = new Set();
async function locked(key, fn) {
  demand(!active.has(key), "该项目有操作正在执行，请稍候", 409);
  active.add(key);
  try {
    return await fn();
  } finally {
    active.delete(key);
  }
}
function seed() {
  if (store.state.projects.length) return;
  const p = store.createProject("neon-reliquary", "人类、AI 与芯片的共同远征");
  const a = store.createRelease(
    p.id,
    parseFiles({ files: sampleFiles(1) }),
    { type: "sample" },
    "初次启航",
  );
  // A seeded sample remains a preview until the user explicitly approves it.
  store.createRelease(
    p.id,
    parseFiles({ files: sampleFiles(2) }),
    { type: "sample" },
    "新的冒险，从这里开始",
  );
}
seed();
const app = express();
const server = createHttpServer(app);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.hostname;
  if (!["127.0.0.1", "localhost"].includes(host))
    return res.status(403).json({ error: "本地 Demo 仅接受 loopback 主机" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const origin = req.headers.origin;
  if (
    origin &&
    ![
      "http://127.0.0.1:" + PORT,
      "http://localhost:" + PORT,
      "http://127.0.0.1:4310",
    ].includes(origin)
  )
    return res.status(403).json({ error: "不允许此来源" });
  if (
    req.path.startsWith("/api/") &&
    req.method !== "GET" &&
    req.headers["x-deweb-token"] !== sessionToken
  )
    return res.status(403).json({ error: "会话已失效，请刷新" });
  next();
});
app.use(express.json({ limit: "16mb" }));
app.get("/api/session", (req, res) =>
  res.json({
    token: sessionToken,
    mode: "local",
    chain: CHAIN,
    chains: Object.values(CHAINS),
    previewPort: PREVIEW_PORT,
  }),
);
const oauth = createOAuthService(store, dataDir, {baseUrl: "http://127.0.0.1:" + PORT});
mountOAuthRoutes(app, oauth, "http://127.0.0.1:" + PORT);
mountSourceRoutes(app, {store, oauth});
mountBatch2Routes(app,{store,oauth});
mountP0DataRoutes(app,{store,oauth});
mountCfDomainRoutes(app,{store,oauth,cfRequest});
mountGatewayRoutes(app,{store,environment:{GATEWAY_ENABLED:'false'},user:{id:'local'}});
mountEcosystemRoutes(app,{store,oauth,locked});
mountProjectRoutes(app, {store, oauth, dataDir, checkConnection, deployCloudflare, cfRequest, locked});
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
app.use("/docs", express.static(path.join(root, "public/docs")));
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*splat}", (req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({
    error:
      status === 500
        ? "操作未完成，请检查连接、构建包格式或服务配置"
        : error.message,
  });
  if (status === 500)
    console.error(
      "Request failed:",
      req.method,
      req.path,
      error.code || error.name,
    );
});

const previews = express();
previews.disable("x-powered-by");
previews.use((req, res) => {
  const host = req.hostname.match(
    /^(?:(d-[a-f0-9]{12})\.)?(p-[a-f0-9]{12})\.localhost$/,
  );
  if (!host) return res.status(404).send("Preview host not found");
  const [, version, pid] = host;
  const rid =
    version || store.state.projects.find((p) => p.id === pid)?.productionId;
  const r = store.state.releases.find(
    (r) => r.id === rid && r.projectId === pid,
  );
  if (!r) return res.status(404).send("Preview not found");
  let requested;
  try {
    requested =
      decodeURIComponent(req.path).normalize("NFC").slice(1) || "index.html";
  } catch {
    return res.status(400).send("Invalid path");
  }
  if (requested.endsWith("/")) requested += "index.html";
  let file = r.files.find((f) => f.path === requested);
  if (!file && !requested.split("/").pop().includes("."))
    file = r.files.find((f) => f.path === requested + "/index.html");
  if (!file && !requested.split("/").pop().includes("."))
    file = r.files.find((f) => f.path === "index.html");
  if (!file) return res.status(404).send("File not found");
  const bytes = Buffer.from(file.base64, "base64");
  if (sha(bytes) !== file.sha256)
    return res.status(409).send("Artifact integrity check failed");
  res.set({
    "Content-Type": file.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control":
      !version || file.path === "index.html"
        ? "no-store"
        : "public,max-age=31536000,immutable",
    "Content-Security-Policy":
      "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors http://127.0.0.1:" +
      PORT +
      " http://localhost:" +
      PORT +
      " http://127.0.0.1:4310",
  });
  if (file.path === "index.html") {
    store.state.visits.push({ projectId: pid, releaseId: rid, at: now() });
    store.state.visits = store.state.visits.slice(-2000);
    store.save();
  }
  res.send(bytes);
});
server.listen(PORT, "127.0.0.1", () =>
  console.log("DeWeb Workbench: http://127.0.0.1:" + PORT),
);
const previewServer = previews.listen(PREVIEW_PORT, "127.0.0.1");
function shutdown() {
  server.close();
  previewServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
