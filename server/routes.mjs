import {chainFor} from './chains.mjs';
import {startNativeAccess,confirmNativeAccess} from './native-access.mjs';
import {readiness,approveRelease,assertApproved,restoreCheck,validateContract,budgetSummary,publicationStatus} from "./release-policy.mjs";
import {beginSigning} from "./publication-budget.mjs";
import { parseFiles, zipFiles, demand, id, now } from "./core.mjs";
import {prepareChain, confirmTransaction, readback, preflightStep, prepareActivation, reconcileExpenses, revalidateBaseQuote} from "./chain.mjs";
import {sampleFiles} from "./sample.mjs";
export function mountProjectRoutes(app, {store, oauth, dataDir, checkConnection, deployCloudflare, cfRequest, locked, beforePublic=async()=>{},afterPublic=()=>{}}) {
app.get("/api/keys", (_req,res)=>res.json(store.keyRegistry()));
app.post('/api/releases/:rid/native-access/prepare',(req,res)=>res.json(startNativeAccess(store,store.release(req.params.rid))));
app.post('/api/releases/:rid/native-access/confirm',(req,res)=>res.json(confirmNativeAccess(store,store.release(req.params.rid),req.body)));
app.get("/api/releases/:rid/readiness", (req,res)=>{const r=store.release(req.params.rid);res.json({...readiness(store,r),budget:budgetSummary(r),workflow:publicationStatus(store,r)});});
app.post("/api/releases/:rid/approve", (req,res)=>res.json(approveRelease(store,store.release(req.params.rid),req.body)));
app.get("/api/releases/:rid/restore-check", (req,res)=>res.json(restoreCheck(store,store.release(req.params.rid))));
app.patch("/api/releases/:rid/compatibility", (req,res)=>{const r=store.release(req.params.rid);demand(!r.plan?.pending&&!r.plan?.signing,"请先恢复待确认交易",409);r.databaseContract=validateContract(req.body);store.save();res.json(readiness(store,r));});
app.get("/api/state", (req, res) => res.json(store.publicState()));
app.post("/api/projects", (req, res) =>
  res.json(store.createProject(req.body.name, req.body.description)),
);
app.patch("/api/projects/:pid", (req, res) => {
  const p = store.project(req.params.pid);
  if (req.body.name !== undefined) {
    demand(
      typeof req.body.name === "string" &&
        req.body.name.trim().length >= 2 &&
        req.body.name.length <= 60,
      "名称需要 2–60 个字符",
    );
    p.name = req.body.name.trim();
  }
  if (req.body.description !== undefined)
    p.description = String(req.body.description).slice(0, 200);
  if (req.body.chain) {
    const { cpuIndex, tokenId } = req.body.chain;
    const network=chainFor(req.body.chain.chainId??p.chain.chainId);
    demand(!store.state.releases.some(r=>r.projectId===p.id&&(r.plan?.pending||r.plan?.signing||r.chainStatus==='publishing')),'请先结束或恢复进行中的发布，再更改链目标',409);
    demand(/^\d*$/.test(cpuIndex) && /^\d*$/.test(tokenId), "请输入数字编号");
    const targetChanged=network.chainId!==p.chain.chainId||cpuIndex!==p.chain.cpuIndex||tokenId!==p.chain.tokenId;
    p.chain = { ...p.chain, chainId:network.chainId, cpuIndex, tokenId, ...(targetChanged?{container:''}:{}) };
    if(targetChanged)delete p.chainObservation;
  }
  if (req.body.databaseVersion !== undefined) {
    demand(typeof req.body.databaseVersion === "string" && /^(?:[a-zA-Z0-9._-]{1,64})?$/.test(req.body.databaseVersion),"数据结构版本格式无效");
    p.databaseVersion = req.body.databaseVersion || null;
  }
  p.updatedAt = now();
  store.save();
  store.log(p.id, "项目设置已保存");
  res.json(p);
});
app.post("/api/projects/:pid/import", (req, res) => {
  const parsed = req.body.zip
    ? zipFiles(Buffer.from(req.body.zip, "base64"))
    : parseFiles(req.body);
  res.json(
    store.createRelease(
      req.params.pid,
      parsed,
      { type: "upload" },
      String(req.body.label || "新构建").slice(0, 100),
    ),
  );
});
app.post("/api/projects/:pid/sample", async (req, res) => {
  const p = store.project(req.params.pid), environment=req.body.environment||"preview";
  demand(["preview","production"].includes(environment),"环境无效");
  const c=store.state.connections[p.id+":supabase:"+environment];
  const config = c?.status === "connected" ? await oauth.credentials(c) : null;
  res.json(
    store.createRelease(
      p.id,
      parseFiles({
        files: sampleFiles(req.body.version === 1 ? 1 : 2, config),
      }),
      { type: "sample", dataEnvironment:environment },
      req.body.version === 1 ? "示例 v1 · 海岸启程" : "示例 v2 · 霓虹远征",
    ),
  );
});
app.post("/api/projects/:pid/promote", (req, res) =>
  res.json(store.promote(req.params.pid, req.body.releaseId)),
);
app.post("/api/projects/:pid/restore", (req, res) =>
  res.json(store.restore(req.params.pid, req.body.releaseId, req.body)),
);
app.get("/api/releases/:rid/receipt", (req, res) => {
  const r = store.release(req.params.rid);
  res.json(r.receipt || store.receiptFor(r));
});
app.get("/api/releases/:rid/export", (req, res) => {
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="' + req.params.rid + '.zip"',
  );
  res.type("application/zip").send(store.exportRelease(req.params.rid));
});
app.get("/api/releases/:rid/files", (req, res) => {
  const r = store.release(req.params.rid);
  res.json(r.files.map(({ base64, ...f }) => f));
});
app.post("/api/releases/:rid/verify", (req, res) => {
  const r = store.release(req.params.rid);
  store.validateRelease(r);
  store.log(r.projectId, "归档完整性再次核验通过", "success", r.id);
  res.json({ verified: true, manifestHash: r.manifestHash });
});
app.post("/api/connections", async (req, res) => {
  const { provider, projectId, environment = "preview", ...input } = req.body;
  store.project(projectId);
  demand(["preview", "production"].includes(environment), "环境无效");
  const checked = await checkConnection(provider, input);
  if (provider === "supabase") input.url = new URL(input.url).origin;
  store.state.connections[projectId + ":" + provider + ":" + environment] = {
    provider,
    projectId,
    environment,
    status: "connected",
    ...checked,
    checkedAt: now(),
    secrets: store.encrypt(input),
  };
  store.save();
  store.log(
    projectId,
    provider + " · " + environment + " 连接验证成功",
    "success",
  );
  res.json({ connected: true, ...checked });
});
app.delete("/api/connections/:key", (req, res) => {
  const c = store.state.connections[req.params.key];
  demand(c, "连接不存在", 404);
  delete store.state.connections[req.params.key];
  store.save();
  store.log(c.projectId, c.provider + " 连接已移除；供应商资源保留");
  res.json({ disconnected: true });
});
app.post("/api/releases/:rid/cloudflare", async (req, res) => {
  const r = store.release(req.params.rid),
    p = store.project(r.projectId);
  demand((r.archive?.state||"available")==="available","请先从回收站恢复归档",409);
  demand(!["preparing","active"].includes(r.privatePreview?.status),"请先撤销私有预览，再明确公开发布",409);
  const production = req.body.production === true,
    environment = production ? "production" : "preview";
  const c = store.state.connections[p.id + ":cloudflare:" + environment];
  demand(
    c?.status === "connected",
    "请先连接 Cloudflare " + environment + " 环境",
    409,
  );
  if(production)assertApproved(store,r);
  await beforePublic(r,production?"cloudflare-production":"cloudflare-preview");
  const result = await locked(p.id, () =>
    oauth
      .credentials(c)
      .then((credentials) =>
        deployCloudflare(store, p, r, credentials, dataDir, { production }),
      ),
  );
  afterPublic(r,production?'cloudflare-production':'cloudflare-preview');
  res.json(result);
});
app.post("/api/releases/:rid/chain/prepare", async (req, res) => {
  const r = store.release(req.params.rid),
    p = store.project(r.projectId);
  demand(
    !store.state.releases.some(
      (x) =>
        x.projectId === p.id && (x.chainStatus === "publishing" || x.plan?.pending || x.plan?.signing) && x.id !== r.id,
    ),
    "请先处理正在发布的版本",
    409,
  );
  if (r.plan?.pending || r.plan?.signing) return res.json(r.plan);
  if (r.plan?.completed.length && r.plan.completed.length < r.plan.steps.length)
    return res.json(r.plan);
  res.json(await locked(p.id, () => prepareChain(store, r, p, req.body.from)));
});
app.get("/api/releases/:rid/chain/plan", (req, res) =>
  res.json(store.release(req.params.rid).plan || null),
);
app.post("/api/releases/:rid/chain/preflight", async (req, res) => {
  const r = store.release(req.params.rid);
  res.json(await locked(r.projectId, () => preflightStep(store, r)));
});
app.post("/api/releases/:rid/chain/intent", async (req, res) => {
  const r = store.release(req.params.rid);
  await revalidateBaseQuote(r);
  const intent=beginSigning(store,r,req.body);
  await beforePublic(r,"chain-signing");
  res.json(intent);
});
app.post("/api/releases/:rid/chain/rejected", (req, res) => {
  const r = store.release(req.params.rid);
  demand(r.plan?.signing && !r.plan.pending, "没有可取消的签署", 409);
  delete r.plan.signing;
  store.save();
  res.json({ cancelled: true });
});
app.post("/api/releases/:rid/chain/pending", (req, res) => {
  const r = store.release(req.params.rid);
  demand(
    r.plan &&
      req.body.index === r.plan.completed.length &&
      /^0x[0-9a-f]{64}$/i.test(req.body.hash),
    "待确认交易无效",
  );
  r.plan.pending = { index: req.body.index, hash: req.body.hash };
  store.save();
  res.json({ saved: true });
});
app.post("/api/releases/:rid/chain/confirm", async (req, res) => {
  const r = store.release(req.params.rid);
  res.json(
    await locked(r.projectId, () =>
      confirmTransaction(store, r, req.body.index, req.body.hash),
    ),
  );
});
app.post("/api/releases/:rid/chain/costs", async (req,res)=>{const r=store.release(req.params.rid);res.json(await locked(r.projectId,()=>reconcileExpenses(store,r)));});
app.post("/api/releases/:rid/chain/readback", async (req, res) => {
  const r = store.release(req.params.rid);
  const result=await locked(r.projectId, () => readback(store, r));
  afterPublic(r,'chain-verified');
  res.json(result);
});
app.post("/api/releases/:rid/chain/activation", async (req, res) => {
  const r = store.release(req.params.rid);
  res.json(await locked(r.projectId, () => prepareActivation(store, r)));
});
app.post("/api/projects/:pid/domains", (req, res) => {
  const p = store.project(req.params.pid),
    hostname = String(req.body.hostname || "")
      .trim()
      .toLowerCase();
  demand(
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname),
    "请输入有效域名，不包含协议或路径",
  );
  demand(
    !store.state.domains.some((d) => d.hostname === hostname),
    "域名已存在",
    409,
  );
  const domain = {
    id: id("dom"),
    projectId: p.id,
    provider: ["hashport","gateway"].includes(req.body.provider)?req.body.provider:"pages",
    hostname,
    status: "pending",
    createdAt: now(),
    detail: req.body.provider==="gateway"?"已登记，请准备 Gateway 域名与证书":req.body.provider==="hashport"?"已登记，请继续核验链上绑定与 DNS":"已登记。需要 Cloudflare Pages 真实部署与域名 DNS 配置。",
  };
  store.state.domains.push(domain);
  store.save();
  res.json(domain);
});
app.post("/api/domains/:did/connect", async (req, res) => {
  const d = store.state.domains.find((d) => d.id === req.params.did);
  demand(d?.provider!=="gateway","请使用 Gateway 的域名与证书流程",409);
  demand(d, "域名不存在", 404);
  demand(d.provider !== 'hashport', 'HashPort 域名请使用链上绑定流程', 409);
  const project = store.project(d.projectId),
    r = store.state.releases.find(
      (r) => r.id === project.cloudflareProductionId,
    ),
    c = store.state.connections[d.projectId + ":cloudflare:production"];
  demand(
    r?.cloudflareProduction?.status === "success" && c,
    "请先完成 Cloudflare 生产镜像部署",
    409,
  );
  const credentials = await oauth.credentials(c),
    base =
      "/accounts/" +
      credentials.accountId +
      "/pages/projects/" +
      r.cloudflareProduction.projectName +
      "/domains";
  const existing = await cfRequest(credentials, base);
  const remote =
    existing.find((x) => x.name === d.hostname) ||
    (await cfRequest(credentials, base, {
      method: "POST",
      body: JSON.stringify({ name: d.hostname }),
    }));
  d.status = remote.status === "active" ? "active" : "pending";
  d.detail = "Cloudflare: " + remote.status;
  d.target = r.cloudflareProduction.projectName + ".pages.dev";
  store.save();
  res.json(d);
});
app.delete("/api/domains/:did", (req, res) => {
  const d = store.state.domains.find((d) => d.id === req.params.did);
  demand(d, "域名不存在", 404);
  demand(!d.gateway?.cfId,'请先断开 Gateway 域名与证书',409);
  demand(d.status !== "active", "请先在供应商解除活动域名绑定", 409);
  store.state.domains = store.state.domains.filter((x) => x.id !== d.id);
  store.save();
  res.json({ removed: true });
});
app.post("/api/projects/:pid/environment", (req, res) => {
  const p = store.project(req.params.pid),
    { key, value, environment, secret, stage = "build" } = req.body;
  demand(["build","runtime"].includes(stage),"配置阶段无效");
  demand(
    /^[A-Z][A-Z0-9_]{1,63}$/.test(key),
    "配置名使用大写字母、数字和下划线",
  );
  demand(["preview", "production"].includes(environment), "环境无效");
  demand(typeof value === "string" && value.length <= 8000, "配置值过长");
  const record = {
    id: id("env"),
    key,
    stage,
    environment,
    secret: Boolean(secret),
    value: secret ? "••••••••" : value,
    updatedAt: now(),
  };
  if (secret) {
    store.state.connections[p.id + ":env:" + record.id] = {
      provider: "secret",
      projectId: p.id,
      label: key,
      secrets: store.encrypt({ value }),
      status: "stored",
    };
  }
  for (const old of p.environment)
    if (old.key === key && old.environment === environment)
      delete store.state.connections[p.id + ":env:" + old.id];
  p.environment = p.environment.filter(
    (e) => e.key !== key || e.environment !== environment,
  );
  p.environment.push(record);
  store.save();
  res.json(record);
});
app.delete("/api/projects/:pid/environment/:eid", (req, res) => {
  const p = store.project(req.params.pid);
  p.environment = p.environment.filter((e) => e.id !== req.params.eid);
  delete store.state.connections[p.id + ":env:" + req.params.eid];
  store.save();
  res.json({ removed: true });
});

}
