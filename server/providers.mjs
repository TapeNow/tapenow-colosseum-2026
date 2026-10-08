import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { demand, now } from "./core.mjs";
const exec = promisify(execFile);
export async function checkedUrl(value, { supabase = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效的 HTTPS 地址");
  }
  demand(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443"),
    "只允许公开 HTTPS 地址",
  );
  if (supabase)
    demand(
      /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname),
      "Demo 支持 Supabase 官方项目域名",
    );
  const hosts = await dns.lookup(url.hostname, { all: true });
  demand(
    hosts.length > 0 && hosts.every((h) => !privateIp(h.address)),
    "不能连接本地或内部网络",
  );
  return url;
}
export function privateIp(ip) {
  if (net.isIP(ip) === 6) return /^(::|fc|fd|fe80|::ffff:)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return (
    !net.isIP(ip) ||
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
export async function cfRequest(credentials, endpoint, init = {}) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4" + endpoint,
    {
      ...init,
      headers: {
        Authorization: "Bearer " + credentials.token,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = await response.json();
  demand(
    response.ok && body.success,
    "Cloudflare：" + (body.errors?.[0]?.message || "请求失败"),
    502,
  );
  return body.result;
}
export async function checkConnection(provider, input) {
  if (provider === "cloudflare") {
    demand(
      /^[a-f0-9]{32}$/i.test(input.accountId || "") &&
        input.token?.length >= 20,
      "请填写 Cloudflare Account ID 和 API Token",
    );
    const result = await cfRequest(
      input,
      "/accounts/" + input.accountId + "/pages/projects",
    );
    return {
      label: "Cloudflare Pages",
      detail: "账号验证成功 · " + result.length + " 个现有项目",
    };
  }
  if (provider === "supabase") {
    const url = await checkedUrl(input.url, { supabase: true });
    demand(
      typeof input.key === "string" &&
        (input.key.startsWith("sb_publishable_") ||
          input.key.startsWith("eyJ")),
      "请输入公开 publishable / anon key",
    );
    demand(!input.key.startsWith("sb_secret_"), "请勿使用管理密钥");
    if (input.key.startsWith("eyJ")) {
      let jwt;
      try {
        jwt = JSON.parse(
          Buffer.from(input.key.split(".")[1], "base64url").toString(),
        );
      } catch {}
      demand(jwt?.role === "anon", "只接受 anon key，不能使用 service_role");
    }
    const response = await fetch(url.origin + "/auth/v1/settings", {
      headers: { apikey: input.key },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    demand(response.ok, "Supabase 连接失败，请核对项目与公开 key", 502);
    return {
      label: url.hostname.split(".")[0],
      detail: "Auth API 可达 · RLS 与业务表权限尚需独立验收",
    };
  }
  if (provider === "github") {
    demand(
      /^[\w.-]+\/[\w.-]+$/.test(input.repository || ""),
      "仓库格式为 owner/repository",
    );
    const response = await fetch(
      "https://api.github.com/repos/" + input.repository,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(input.token ? { Authorization: "Bearer " + input.token } : {}),
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    demand(response.ok, "无法读取 GitHub 仓库", 502);
    const repo = await response.json();
    return {
      label: repo.full_name,
      detail: "仓库可读 · 默认分支 " + repo.default_branch,
    };
  }
  throw new Error("尚不支持此连接类型");
}
export async function deployCloudflare(
  store,
  project,
  release,
  credentials,
  dataDir,
  { production = false } = {},
) {
  store.validateRelease(release);
  const projectName = "dw-" + project.id.slice(2);
  const root = path.join(dataDir, "cloud-staging", release.id);
  await fs.mkdir(root, { recursive: true });
  for (const f of release.files) {
    const dest = path.join(root, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(f.base64, "base64"));
  }
  let projects = await cfRequest(
    credentials,
    "/accounts/" + credentials.accountId + "/pages/projects",
  );
  if (!projects.some((p) => p.name === projectName))
    await cfRequest(
      credentials,
      "/accounts/" + credentials.accountId + "/pages/projects",
      {
        method: "POST",
        body: JSON.stringify({ name: projectName, production_branch: "main" }),
      },
    );
  const cli = path.resolve("node_modules/wrangler/bin/wrangler.js");
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CLOUDFLARE_API_TOKEN: credentials.token,
    CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  const branch = production ? "main" : release.id;
  await exec(
    process.execPath,
    [
      cli,
      "pages",
      "deploy",
      root,
      "--project-name",
      projectName,
      "--branch",
      branch,
      "--commit-hash",
      release.manifestHash.slice(0, 40),
      "--commit-dirty=true",
    ],
    { env, timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
  );
  const deployments = await cfRequest(
    credentials,
    "/accounts/" +
      credentials.accountId +
      "/pages/projects/" +
      projectName +
      "/deployments",
  );
  const deployed = deployments.find(
    (d) =>
      d.deployment_trigger?.metadata?.branch === branch &&
      d.deployment_trigger?.metadata?.commit_hash ===
        release.manifestHash.slice(0, 40),
  );
  demand(deployed?.url, "已提交部署，但暂未读到部署 URL；请刷新检查", 502);
  const field = production ? "cloudflareProduction" : "cloudflare";
  release[field] = {
    id: deployed.id,
    url: deployed.url,
    projectName,
    status: deployed.latest_stage?.status || "unknown",
    environment: production ? "production" : "preview",
    checkedAt: now(),
  };
  if (production && release[field].status === "success")
    project.cloudflareProductionId = release.id;
  store.save();
  demand(
    release[field].status === "success",
    "Cloudflare 尚未确认部署成功：" + release[field].status,
    409,
  );
  store.log(
    project.id,
    "Cloudflare " + (production ? "生产镜像" : "预览") + " 部署成功",
    "success",
    release.id,
  );
  return release[field];
}
