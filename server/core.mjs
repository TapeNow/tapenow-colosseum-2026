import {
  createHash,
  randomBytes,
  generateKeyPairSync,
  sign,
  verify,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { configurationSnapshot, buildDigest, assertApproved, assertRestore, publicationStatus, budgetSummary } from "./release-policy.mjs";
import {keyRegistry} from "./receipt-keys.mjs";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";

export const MAX_BYTES = 10 * 1024 * 1024;
export const sha = (b) => createHash("sha256").update(b).digest("hex");
export const id = (prefix) => prefix + "-" + randomBytes(6).toString("hex");
export const now = () => new Date().toISOString();
export function demand(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export function safePath(value) {
  demand(typeof value === "string" && value.length <= 240, "文件路径无效");
  value = value.normalize("NFC");
  demand(
    !value.includes("\\") &&
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !value.includes("%"),
    "文件路径不安全",
  );
  const parts = value.split("/");
  demand(
    parts.every((x) => x && x !== "." && x !== ".." && !x.startsWith(".")),
    "不允许隐藏文件或越界路径",
  );
  demand(!/[\x00-\x1f\x7f?#:]/.test(value), "文件路径包含不支持的字符");
  demand(
    !parts.some((x) => /^(node_modules|\.git)$/i.test(x)),
    "请上传构建目录",
  );
  demand(
    !/^(_worker\.js(?:\/|$)|_routes\.json$|_headers$|_redirects$|functions\/)/i.test(
      value,
    ),
    "Demo 只接收静态文件，不接收供应商执行脚本或路由配置",
  );
  return value;
}
const types = {
  html: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain",
  wasm: "application/wasm",
  mp4: "video/mp4",
};
export const mime = (name) =>
  types[name.split(".").pop().toLowerCase()] || "application/octet-stream";
export function parseFiles(input) {
  demand(
    input &&
      Array.isArray(input.files) &&
      input.files.length > 0 &&
      input.files.length <= 500,
    "请选择 1–500 个构建文件",
  );
  let total = 0;
  const seen = new Set();
  const files = input.files
    .map((f) => {
      const name = safePath(f.path);
      demand(!seen.has(name), "重复文件：" + name);
      seen.add(name);
      demand(
        typeof f.base64 === "string" && /^[a-zA-Z0-9+/]*={0,2}$/.test(f.base64),
        "文件编码无效",
      );
      const bytes = Buffer.from(f.base64, "base64");
      total += bytes.length;
      demand(total <= MAX_BYTES, "构建包上限为 10 MiB");
      if (/\.(html|js|mjs|json|txt)$/i.test(name)) {
        const text = bytes.toString();
        demand(
          !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|(?:SUPABASE_SERVICE_ROLE_KEY|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_\-.]{16,}/i.test(
            text,
          ),
          "检测到疑似秘密，请移出公开文件：" + name,
        );
        for (const token of text.match(
          /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        ) || []) {
          let payload;
          try {
            payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
          } catch {}
          demand(
            payload?.role !== "service_role",
            "检测到 Supabase 管理密钥：" + name,
          );
        }
      }
      return {
        path: name,
        bytes: bytes.length,
        sha256: sha(bytes),
        contentType: mime(name),
        base64: bytes.toString("base64"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  demand(seen.has("index.html"), "构建目录根部需要 index.html");
  return {
    files,
    bytes: total,
    manifestHash: sha(JSON.stringify(files.map(({ base64, ...f }) => f))),
  };
}
export function zipFiles(buffer) {
  demand(buffer.length <= MAX_BYTES, "ZIP 超过 10 MiB");
  let total = 0,
    count = 0;
  const seen = new Set();
  const contents = unzipSync(new Uint8Array(buffer), {
    filter(entry) {
      if (entry.name.endsWith("/")) return false;
      demand(++count <= 500, "ZIP 文件数量过多");
      total += entry.originalSize;
      demand(total <= MAX_BYTES, "ZIP 解压后超过 10 MiB");
      safePath(entry.name);
      demand(!seen.has(entry.name), "ZIP 包含重复路径");
      seen.add(entry.name);
      return true;
    },
  });
  let names = Object.keys(contents);
  const root = names.every(
    (x) => x.includes("/") && x.split("/")[0] === names[0].split("/")[0],
  )
    ? names[0].split("/")[0] + "/"
    : "";
  return parseFiles({
    files: names.map((n) => ({
      path: root ? n.slice(root.length) : n,
      base64: Buffer.from(contents[n]).toString("base64"),
    })),
  });
}
export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filename = path.join(dir, "state.json");
  const keyfile = path.join(dir, "vault.key");
  if (!fs.existsSync(keyfile))
    fs.writeFileSync(keyfile, randomBytes(32), { mode: 0o600 });
  const vaultKey = fs.readFileSync(keyfile);
  const signing = path.join(dir, "signing-private.pem");
  if (!fs.existsSync(signing)) {
    const pair = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    fs.writeFileSync(signing, pair.privateKey, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "signing-public.pem"), pair.publicKey);
  }
  const priv = fs.readFileSync(signing),
    pub = fs.readFileSync(path.join(dir, "signing-public.pem"), "utf8");
  const state = fs.existsSync(filename)
    ? JSON.parse(fs.readFileSync(filename, "utf8")) : emptyState();
  return createMemoryStore({ state, vaultKey, privateKey: priv, publicKey: pub,
    onSave(value) {
      const temp = filename + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
      fs.renameSync(temp, filename);
    }
  });
}
export function emptyState() {
  return {schema: 1, projects: [], releases: [], logs: [], connections: {},
    domains: [], visits: [], preferences: {locale: "zh-CN"}};
}
// Same domain operations for local files and an owner-scoped cloud transaction.
// The cloud adapter commits only after the HTTP operation and archive writes finish.
export function createMemoryStore({state = emptyState(), vaultKey, privateKey: priv,
  publicKey: pub, keyHistory = [], mode = "local", onSave = () => {}}) {
  const keys = keyRegistry(pub, keyHistory);
  const save = () => onSave(state);
  const log = (projectId, message, level = "info", releaseId = null) => {
    state.logs.unshift({
      id: id("log"),
      projectId,
      releaseId,
      message,
      level,
      at: now(),
    });
    state.logs = state.logs.slice(0, 1000);
    save();
  };
  const encrypt = (value) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      data: data.toString("hex"),
    };
  };
  const decrypt = (box) => {
    const dec = createDecipheriv(
      "aes-256-gcm",
      vaultKey,
      Buffer.from(box.iv, "hex"),
    );
    dec.setAuthTag(Buffer.from(box.tag, "hex"));
    return JSON.parse(
      Buffer.concat([
        dec.update(Buffer.from(box.data, "hex")),
        dec.final(),
      ]).toString(),
    );
  };
  function createProject(name, description = "") {
    demand(
      typeof name === "string" &&
        name.trim().length >= 2 &&
        name.trim().length <= 60,
      "项目名称需要 2–60 个字符",
    );
    const project = {
      id: id("p"),
      name: name.trim(),
      description: String(description).slice(0, 200),
      createdAt: now(),
      updatedAt: now(),
      productionId: null,
      chain: { chainId: 196, cpuIndex: "", tokenId: "", container: "" },
      environment: [],
      repository: null,
    };
    state.projects.unshift(project);
    save();
    log(project.id, "项目已创建");
    return project;
  }
  const project = (pid) => {
    const p = state.projects.find((p) => p.id === pid);
    demand(p, "项目不存在", 404);
    return p;
  };
  const release = (rid) => {
    const r = state.releases.find((r) => r.id === rid);
    demand(r, "版本不存在", 404);
    return r;
  };
  function createRelease(
    pid,
    artifact,
    source = { type: "upload" },
    label = "",
  ) {
    const p = project(pid),
      rid = id("d");
    const r = {
      id: rid,
      projectId: pid,
      label: label || "更新发布",
      createdAt: now(),
      source,
      status: "ready",
      environment: "preview",
      chainStatus: "not_published",
      manifestHash: artifact.manifestHash,
      bytes: artifact.bytes,
      files: artifact.files,
      receipt: null,
      cloudflare: null,
      transactions: [],
      checks: [
        { label: "文件结构", status: "passed" },
        { label: "SHA-256 清单", status: "passed" },
        { label: "秘密检查", status: "passed" },
      ],
    };
    r.configuration = configurationSnapshot({state,project},pid);
    r.buildDigest = buildDigest(r.configuration,source);
    state.releases.unshift(r);
    p.updatedAt = now();
    save();
    log(
      pid,
      "已验证 " + r.files.length + " 个文件，归档已创建",
      "success",
      rid,
    );
    return r;
  }
  function validateRelease(r) {
    demand(!["purging","purged"].includes(r.archive?.state),"归档已经清除，仅保留清单与历史回执",410);
    const parsed = parseFiles({ files: r.files });
    demand(
      parsed.manifestHash === r.manifestHash,
      "归档文件与发布清单不符",
      409,
    );
    return parsed;
  }
  function receiptFor(r, kind = mode + "-preview") {
    validateRelease(r);
    const payload = structuredClone({
      schema: "deweb-release/v1",
      keyId: keys.currentKeyId,
      configurationDigest: r.approval?.digest || null,
      artifactConfiguration: r.configuration || null,
      approvedConfiguration: r.approvedConfiguration || null,
      databaseContract: r.databaseContract || null,
      publication: r.site?.status === "published" ? {url:r.site.url,stableUrl:r.site.stableUrl,manifestHash:r.site.manifestHash,accessCheck:r.site.accessCheck||null} : null,
      approval: r.approval || null,
      nativeAccess: r.nativeAccess?.status === 'observed' ? r.nativeAccess : null,
      budget: budgetSummary(r),
      releaseId: r.id,
      projectId: r.projectId,
      manifestHash: r.manifestHash,
      source: r.source,
      files: r.files.map(({ base64, ...f }) => f),
      issuedAt: now(),
      kind,
      chain: r.verification || null,
      transactions: r.transactions,
      authorizedWallet: r.plan?.from || null,
      restoredFrom: r.restoredFrom || null,
    });
    const message = JSON.stringify(payload),
      signature = sign(null, Buffer.from(message), priv).toString("base64");
    return {
      payload,
      signature,
      algorithm: "Ed25519",
      publicKey: pub,
      trust: "TapeNow 工作台签发，非第三方审计",
    };
  }
  function promote(pid, rid) {
    const p = project(pid),
      r = release(rid);
    demand(r.projectId === pid, "版本不属于当前项目", 403);
    validateRelease(r);
    assertApproved({state,project},r);
    for (const old of state.releases)
      if (old.projectId === pid) old.environment = "preview";
    p.productionId = rid;
    p.updatedAt = now();
    r.environment = mode + "-production";
    r.receipt = receiptFor(
      r,
      r.chainStatus === "verified"
        ? "chain-file-verification"
        : r.site?.status === "published" || r.cloudflareProduction?.status === "success" ? "cloud-file-verification" : mode + "-preview",
    );
    save();
    log(pid, "已设为工作台当前版本；外部发布状态保持独立", "success", rid);
    return r;
  }
  function restore(pid, rid, input = {}) {
    const p = project(pid),
      original = release(rid);
    demand(original.projectId === pid, "版本不属于当前项目", 403);
    demand((original.archive?.state||"available")==="available","请先从回收站恢复归档",409);
    assertRestore({state,project},original,input);
    const r = createRelease(
      pid,
      validateRelease(original),
      { type: "restore", releaseId: rid },
      "恢复 · " + original.label,
    );
    r.restoredFrom = rid;
    r.configuration = original.configuration ? structuredClone(original.configuration) : null;
    r.buildDigest = original.buildDigest || null;
    r.databaseContract = original.databaseContract ? structuredClone(original.databaseContract) : undefined;
    r.restoreCheck = {digest:input.digest,acknowledgeUnknown:input.acknowledgeUnknown===true,at:now()};
    r.receipt = receiptFor(r, mode + "-restore-candidate");
    save();
    log(pid, "恢复候选版本已创建；请确认后发布，当前入口与业务数据库未修改", "info", r.id);
    return r;
  }
  function exportRelease(rid) {
    const r = release(rid);
    validateRelease(r);
    const receipt = r.receipt || receiptFor(r);
    const entries = Object.fromEntries(
      r.files.map((f) => ["site/" + f.path, Buffer.from(f.base64, "base64")]),
    );
    entries["release.json"] = Buffer.from(JSON.stringify(receipt, null, 2));
    entries["keys.json"] = Buffer.from(JSON.stringify(keys,null,2));
    entries["VERIFY.txt"] = Buffer.from(
      "release.json 包含完整 manifest、Ed25519 签名和公钥。签名输入为 JSON.stringify(receipt.payload)。必须通过独立渠道核对并固定公钥 SHA-256 指纹；同包 keys.json 不能自行建立信任。使用 scripts/verify-release.mjs 验签和校验文件（公开文档 /docs/receipt-verification）。site/ 是原始发布文件。kind 为 local-* 时不代表已经上链。\n",
    );
    return Buffer.from(zipSync(entries));
  }
  function publicState() {
    const visible = Object.fromEntries(
      ["schema", "projects", "releases", "logs", "connections", "domains", "visits", "preferences"]
        .map(key => [key, state[key]]));
    return {
      ...visible,
      connections: Object.fromEntries(
        Object.entries(state.connections).map(([key, c]) => [
          key,
          {
            provider: c.provider,
            projectId: c.projectId,
            environment: c.environment,
            status: c.status,
            checkedAt: c.checkedAt,
            label: c.label,
            detail: c.detail,
            authMethod: c.authMethod || "manual",
            grantId: c.grantId,
          },
        ]),
      ),
      releases: state.releases.map(({ files, plan, ...r }) => ({
        ...r,
        workflow: publicationStatus({state,project},{...r,files,plan}),
        budgetSummary: budgetSummary(r),
        files: files.map(({ base64, ...f }) => f),
      })),
      publicKey: pub,
    };
  }
  return {
    state,
    save,
    log,
    encrypt,
    decrypt,
    createProject,
    project,
    release,
    createRelease,
    validateRelease,
    promote,
    restore,
    exportRelease,
    receiptFor,
    publicState,
    keyRegistry: () => keys,
  };
}
export function verifyReceipt(receipt) {
  return verify(
    null,
    Buffer.from(JSON.stringify(receipt.payload)),
    receipt.publicKey,
    Buffer.from(receipt.signature, "base64"),
  );
}
