import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { demand, id, now } from "./core.mjs";
import { checkConnection } from "./providers.mjs";

export const OAUTH_PROVIDERS = {
  github: {name: "GitHub", authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", api: "https://api.github.com"},
  vercel: {name: "Vercel", token: "https://api.vercel.com/v2/oauth/access_token", api: "https://api.vercel.com"},
  cloudflare: {
    name: "Cloudflare",
    authorize: "https://dash.cloudflare.com/oauth2/auth",
    token: "https://dash.cloudflare.com/oauth2/token",
    revoke: "https://dash.cloudflare.com/oauth2/revoke",
    api: "https://api.cloudflare.com/client/v4",
  },
  supabase: {
    name: "Supabase",
    authorize: "https://api.supabase.com/v1/oauth/authorize",
    token: "https://api.supabase.com/v1/oauth/token",
    revoke: "https://api.supabase.com/v1/oauth/revoke",
    api: "https://api.supabase.com/v1",
  },
};
const random = () => randomBytes(32).toString("base64url");
const digest = (s) => createHash("sha256").update(s).digest("base64url");
// Callback failures carry a short reason code so the workbench can explain what to retry.
const fail = (reason, message, status = 400) => Object.assign(new Error(message), {status, reason});
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Operator-only configuration, encrypted with the existing local vault key.
export function writeOAuthClient(store, dataDir, provider, input) {
  demand(Object.hasOwn(OAUTH_PROVIDERS, provider), "不支持的 OAuth 服务");
  demand(
    typeof input.clientId === "string" && input.clientId.length > 5,
    "应用 ID 无效",
  );
  demand(
    typeof input.clientSecret === "string" && input.clientSecret.length > 10,
    "应用密钥无效",
  );
  demand(
    !input.scopes ||
      (Array.isArray(input.scopes) &&
        input.scopes.every((s) => typeof s === "string")),
    "权限格式无效",
  );
  if (input.redirectUri) {
    const callback = new URL(input.redirectUri);
    demand(
      callback.protocol === "https:" &&
        !callback.username &&
        !callback.password &&
        !callback.search &&
        !callback.hash,
      "外部回调必须是固定的 HTTPS 地址",
    );
  }
  const file = path.join(dataDir, "oauth-clients.json");
  const clients = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  clients[provider] = store.encrypt({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    scopes: input.scopes || [],
    ...(input.visibility === "private" || input.visibility === "public"
      ? { visibility: input.visibility }
      : {}),
    ...(input.slug ? {slug: String(input.slug)} : {}),
    ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}),
  });
  fs.writeFileSync(file + ".tmp", JSON.stringify(clients), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}

export function createOAuthService(
  store,
  dataDir,
  {
    baseUrl = "http://127.0.0.1:4311",
    fetchImpl = fetch,
    clock = Date.now,
    connectionCheck = checkConnection,
    clients,
    persistentPending = false,
  } = {},
) {
  const base = new URL(baseUrl);
  demand(
    (base.protocol === "http:" && base.hostname === "127.0.0.1") || base.protocol === "https:",
    "OAuth 回调必须使用 HTTPS 或本机地址",
  );
  const pending = new Map(persistentPending ? Object.entries(store.state.oauthPending || {}) : []),
    refreshing = new Map(),
    revoking = new Set();
  store.state.oauthGrants ||= {};
  const persistPending = () => {if (persistentPending) {store.state.oauthPending = Object.fromEntries(pending); store.save();}};
  const secure = base.protocol === "https:" ? "; Secure" : "";
  const config = (provider) => {
    demand(Object.hasOwn(OAUTH_PROVIDERS, provider), "不支持的 OAuth 服务");
    if (clients) {
      demand(clients[provider]?.clientId && clients[provider]?.clientSecret, "此服务尚未配置授权应用", 409);
      return {...clients[provider], scopes: clients[provider].scopes || [], redirectUri: base.origin + "/api/oauth/" + provider + "/callback"};
    }
    const file = path.join(dataDir, "oauth-clients.json");
    const value = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))[provider]
      : null;
    demand(value, "此服务尚未配置 OAuth 应用，可先使用手动连接", 409);
    return store.decrypt(value);
  };
  const grant = (gid) => {
    const g = store.state.oauthGrants[gid];
    demand(g, "授权不存在", 404);
    demand(!revoking.has(gid), "授权正在撤销，请稍候", 409);
    demand(g.status === "authorized", "授权已失效，请重新授权", 409);
    return g;
  };
  function markInvalid(g) {
    g.status = "reauthorize";
    for (const c of Object.values(store.state.connections)) {
      if (c.grantId === g.id) {
        c.status = "reauthorize";
        c.detail = "OAuth 授权失效，请重新授权并绑定";
      }
    }
    store.save();
  }
  function status() {
    return {
      providers: Object.entries(OAUTH_PROVIDERS).map(([provider, p]) => {
        let configured = false;
        let callbackUrl = base.origin + "/api/oauth/" + provider + "/callback";
        try {
          callbackUrl = config(provider).redirectUri || callbackUrl;
          configured = true;
        } catch {}
        return {
          provider,
          name: p.name,
          configured,
          callbackUrl,
          ...(configured && ["private", "public"].includes(config(provider).visibility)
            ? { visibility: config(provider).visibility }
            : {}),
          ...(provider === "github" && configured ? {installUrl: "https://github.com/apps/"+config(provider).slug+"/installations/new"} : {}),
        };
      }),
      grants: Object.values(store.state.oauthGrants).map(
        ({ tokens, client, ...g }) => ({
          ...g,
          bindings: Object.values(store.state.connections).filter(
            (c) => c.grantId === g.id,
          ).length,
        }),
      ),
    };
  }
  function start(provider, requestOrigin, context = {}) {
    demand(
      requestOrigin === base.origin,
      "请从 " + base.origin + " 打开工作台后授权",
      400,
    );
    const c = config(provider),
      p = OAUTH_PROVIDERS[provider];
    if (context.projectId) store.project(context.projectId);
    demand(
      !context.environment ||
        ["preview", "production"].includes(context.environment),
      "环境无效",
    );
    for (const [key, value] of pending)
      if (value.expires <= clock()) pending.delete(key);
    demand(pending.size < 32, "待处理授权过多，请稍后重试", 429);
    // Vercel's documented external flow lets the user pick the team on Vercel and returns in the
    // same window. The team dashboard route is an optional fallback; it opens the callback in a
    // popup, which Safari may block or isolate from the TapeNow session.
    const teamSlug = provider === "vercel" ? String(context.teamSlug || "").trim().toLowerCase() : "";
    if (teamSlug) demand(/^[a-z0-9][a-z0-9-]{0,63}$/.test(teamSlug), "请输入 Vercel 团队网址中的标识");
    const state = random(),
      verifier = random(),
      binding = random();
    const redirectUri =
      c.redirectUri || base.origin + "/api/oauth/" + provider + "/callback";
    const cookieName = "deweb_oauth_" + state.slice(0, 12);
    pending.set(state, {
      provider,
      verifier,
      binding: digest(binding),
      cookieName,
      redirectUri,
      client: c,
      projectId: context.projectId || "",
      environment: context.environment || "preview",
      expires: clock() + 600000,
    });
    persistPending();
    const url = new URL(provider !== "vercel" ? p.authorize
      : teamSlug ? "https://vercel.com/" + encodeURIComponent(teamSlug) + "/~/integrations/" + encodeURIComponent(c.slug)
      : "https://vercel.com/integrations/" + encodeURIComponent(c.slug) + "/new");
    for (const [key, value] of Object.entries({
      client_id: c.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      code_challenge: digest(verifier),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(key, value);
    if (provider === "vercel") {
      for (const k of [...url.searchParams.keys()]) if(k !== "state") url.searchParams.delete(k);
    }
    if (provider === "cloudflare" && c.scopes.length)
      url.searchParams.set("scope", c.scopes.join(" "));
    return {
      url: url.href,
      cookie: `${cookieName}=${binding}; HttpOnly; SameSite=Lax; Path=/api/oauth; Max-Age=600${secure}`,
    };
  }
  async function tokenRequest(provider, client, fields) {
    const extra = ["github", "vercel"].includes(provider);
    const res = await fetchImpl(OAUTH_PROVIDERS[provider].token, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...(extra ? {} : {Authorization:
          "Basic " +
          Buffer.from(client.clientId + ":" + client.clientSecret).toString(
            "base64",
          )}),
      },
      body: new URLSearchParams(extra ? {...fields, client_id:client.clientId, client_secret:client.clientSecret} : fields),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.access_token !== "string") {
      const err = Object.assign(new Error("供应商未接受授权，请重新连接"), {
        status: 502,
        reason: "provider",
        invalidGrant: body.error === "invalid_grant" || res.status === 401,
        diagnostic: {
          httpStatus: res.status,
          oauthError: [
            "invalid_grant",
            "invalid_client",
            "invalid_request",
            "invalid_scope",
            "unauthorized_client",
          ].includes(body.error)
            ? body.error
            : "token_exchange_failed",
        },
      });
      throw err;
    }
    demand(
      !body.token_type || body.token_type.toLowerCase() === "bearer",
      "供应商令牌类型不受支持",
      502,
    );
    return body;
  }
  function saveTokens(g, result, old = {}) {
    const nonExpiring = g.provider === "vercel" && result.expires_in == null;
    const lifetime = nonExpiring ? null : Number(result.expires_in);
    demand(
      nonExpiring || (Number.isFinite(lifetime) && lifetime > 0),
      "供应商未返回有效的令牌过期时间",
      502,
    );
    g.tokens = store.encrypt({
      accessToken: result.access_token,
      refreshToken: result.refresh_token || old.refreshToken || "",
    });
    g.expiresAt = nonExpiring ? null : clock() + lifetime * 1000;
    g.updatedAt = now();
    g.status = "authorized";
    store.save();
  }
  async function callback(provider, query, cookies) {
    const state = query.state;
    if (typeof state !== "string" || !pending.has(state))
      throw fail("state", "授权状态无效或已使用，请重新发起");
    const attempt = pending.get(state);
    if (attempt.provider !== provider || attempt.expires <= clock())
      throw fail("expired", "授权已过期或服务不匹配");
    const match = String(cookies || "")
      .split(/;\s*/)
      .find((x) => x.startsWith(attempt.cookieName + "="));
    if (!match || !equal(digest(match.slice(attempt.cookieName.length + 1)), attempt.binding))
      throw fail("browser", "请在发起授权的浏览器中完成连接", 403);
    pending.delete(state); // Consume before exchanging the code, including cancellations.
    persistPending();
    if (query.error)
      return {
        cancelled: true,
        ...attempt,
        client: undefined,
        verifier: undefined,
      };
    if (typeof query.code !== "string" || query.code.length > 4096)
      throw fail("provider", "缺少授权码");
    const result = await tokenRequest(provider, attempt.client, {
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: attempt.redirectUri,
      code_verifier: attempt.verifier,
    });
    const g = {
      id: id("oauth"),
      provider,
      label: OAUTH_PROVIDERS[provider].name + " 授权",
      status: "authorized",
      createdAt: now(),
      client: store.encrypt(attempt.client),
      ...(provider === "vercel" ? {teamId: result.team_id || query.teamId || null, configurationId: result.installation_id || query.configurationId || null} : {}),
    };
    store.state.oauthGrants[g.id] = g;
    try {
      saveTokens(g, result);
    } catch (error) {
      delete store.state.oauthGrants[g.id];
      throw error;
    }
    return {
      grantId: g.id,
      projectId: attempt.projectId,
      environment: attempt.environment,
      cookieName: attempt.cookieName,
    };
  }
  async function accessToken(gid, force = false) {
    const g = grant(gid);
    if (refreshing.has(gid)) return refreshing.get(gid);
    const tokens = store.decrypt(g.tokens);
    if ((!force || g.provider === "vercel") && (g.expiresAt > clock() + 60000 || (g.provider === "vercel" && g.expiresAt === null))) return tokens.accessToken;
    const promise = Promise.resolve().then(async () => {
      try {
        if (!tokens.refreshToken) {
          markInvalid(g);
          throw Object.assign(new Error("授权不支持续期，请重新连接"), {
            status: 409,
          });
        }
        const result = await tokenRequest(g.provider, store.decrypt(g.client), {
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        });
        demand(
          store.state.oauthGrants[gid]?.status === "authorized",
          "授权已撤销",
          409,
        );
        saveTokens(g, result, tokens);
        return result.access_token;
      } catch (error) {
        if (error.invalidGrant) markInvalid(g);
        throw error;
      } finally {
        refreshing.delete(gid);
      }
    });
    refreshing.set(gid, promise);
    return promise;
  }
  async function request(gid, endpoint, retry = true) {
    const g = grant(gid),
      token = await accessToken(gid);
    if (g.provider === "vercel" && g.teamId) { const scoped = new URL(endpoint, OAUTH_PROVIDERS.vercel.api); scoped.searchParams.set("teamId", g.teamId); endpoint = scoped.pathname + scoped.search; }
    const res = await fetchImpl(OAUTH_PROVIDERS[g.provider].api + endpoint, {
      headers: { Authorization: "Bearer " + token, ...(g.provider === "github" ? {Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "TapeNow"} : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) {
      if (retry) {
        await accessToken(gid, true);
        return request(gid, endpoint, false);
      }
      markInvalid(g);
      throw Object.assign(new Error("授权已失效，请重新连接"), { status: 409 });
    }
    if (res.status === 403 && g.provider === "vercel") {
      const body = await res.clone().json().catch(() => ({}));
      if (body.error?.invalidToken) {
        markInvalid(g);
        throw Object.assign(new Error("Vercel 集成已被移除或授权失效，请重新连接"), { status: 409 });
      }
    }
    demand(
      res.ok,
      res.status === 403
        ? "授权权限不足，请检查应用权限后重新授权"
        : "供应商资源暂时无法读取",
      502,
    );
    const body = await res.json();
    if (g.provider === "cloudflare") {
      demand(body.success, "Cloudflare 未能完成请求", 502);
      return { data: body.result, pagination: body.result_info };
    }
    return { data: body };
  }
  async function resources(gid) {
    const g = grant(gid);
    if (g.provider === "github") {
      const {data: installations} = await request(gid, "/user/installations?per_page=100");
      const rows = [];
      for (const i of installations.installations || []) {
        for(let page=1; page<=20; page++) {
          const {data} = await request(gid, "/user/installations/"+i.id+"/repositories?per_page=100&page="+page);
          for (const r of data.repositories || []) rows.push({id:r.full_name,name:r.full_name,status:"ready",installationId:i.id,repositoryId:r.id,branch:r.default_branch,private:r.private});
          if((data.repositories || []).length < 100) break;
        }
      }
      return rows;
    }
    if (g.provider === "vercel") {
      const rows=[]; let until="";
      for(let page=0;page<20;page++) {
        const {data}=await request(gid,"/v9/projects?limit=100"+(until?"&until="+until:""));
        rows.push(...(data.projects||[]).map(p=>({id:p.id,name:p.name,status:"ready",framework:p.framework||"static"})));
        until=data.pagination?.next; if(!until)break;
      }
      return rows;
    }
    if (g.provider === "cloudflare") {
      const rows = [];
      for (let page = 1; page <= 20; page++) {
        const { data, pagination } = await request(
          gid,
          "/accounts?per_page=50&page=" + page,
        );
        demand(Array.isArray(data), "供应商资源列表无效", 502);
        rows.push(
          ...data.map((a) => ({ id: a.id, name: a.name, status: "available" })),
        );
        if (!pagination || page >= pagination.total_pages || data.length < 50)
          return rows;
      }
      throw Object.assign(
        new Error("账户数量超过本地首版上限，请使用手动连接"),
        { status: 409 },
      );
    }
    const { data } = await request(gid, "/projects");
    demand(Array.isArray(data), "供应商资源列表无效", 502);
    return data.map((p) => ({
      id: p.ref || p.id,
      name: p.name,
      status: p.status || "unknown",
      region: p.region,
      organizationId: p.organization_id,
    }));
  }
  async function bind(gid, { projectId, environment, resourceId }) {
    const g = grant(gid);
    store.project(projectId);
    demand(["preview", "production"].includes(environment), "环境无效");
    const rows = await resources(gid),
      selected = rows.find((r) => r.id === resourceId);
    demand(selected, "所选资源不在本次授权范围内", 403);
    let input, checked;
    if (g.provider === "cloudflare") {
      demand(/^[a-f0-9]{32}$/i.test(resourceId), "账号 ID 无效");
      input = { accountId: resourceId };
      checked = await connectionCheck("cloudflare", {
        ...input,
        token: await accessToken(gid),
      });
    } else if (g.provider === "github") {
      demand(environment === "preview", "GitHub 连接用于构建来源");
      input = {repository:selected.id, installationId:selected.installationId, repositoryId:selected.repositoryId, branch:selected.branch};
      checked = {label:selected.name, detail:"GitHub App 已验证仓库访问权限"};
      store.project(projectId).repository = selected.id;
    } else if (g.provider === "vercel") {
      input = {projectId:selected.id, teamId:g.teamId};
      checked = {label:selected.name, detail:"Vercel 已验证项目读取权限"};
    } else {
      demand(
        selected.status === "ACTIVE_HEALTHY",
        "Supabase 项目尚未运行，请先在供应商恢复或创建测试项目",
        409,
      );
      demand(/^[a-z0-9-]+$/.test(resourceId), "项目 ID 无效");
      const { data: keys } = await request(
        gid,
        "/projects/" + resourceId + "/api-keys?reveal=true",
      );
      const key =
        keys.find(
          (k) =>
            k.type === "publishable" &&
            k.api_key?.startsWith("sb_publishable_"),
        ) || keys.find((k) => k.name === "anon");
      demand(key?.api_key, "没有可用的公开客户端密钥，请使用手动连接", 409);
      input = {
        url: "https://" + resourceId + ".supabase.co",
        key: key.api_key,
      };
      checked = await connectionCheck("supabase", input);
    }
    // Authorization may have been revoked while the provider requests were running.
    grant(gid);
    const key = projectId + ":" + g.provider + ":" + environment;
    store.state.connections[key] = {
      provider: g.provider,
      projectId,
      environment,
      grantId: gid,
      resourceId,
      authMethod: "oauth",
      status: "connected",
      ...checked,
      label: selected.name,
      checkedAt: now(),
      secrets: store.encrypt(input),
    };
    g.label = selected.name;
    store.save();
    store.log(
      projectId,
      OAUTH_PROVIDERS[g.provider].name +
        " OAuth · " +
        environment +
        " 连接验证成功",
      "success",
    );
    return { connected: true };
  }
  async function credentials(connection) {
    demand(connection?.status === "connected", "连接已失效，请重新连接", 409);
    const input = store.decrypt(connection.secrets);
    if (!connection.grantId) return input;
    const g = grant(connection.grantId);
    demand(g.provider === connection.provider, "授权服务不匹配", 403);
    return ["cloudflare", "github", "vercel"].includes(g.provider)
      ? { ...input, token: await accessToken(g.id) }
      : input;
  }
  async function revoke(gid) {
    const g = store.state.oauthGrants[gid];
    demand(g, "授权不存在", 404);
    demand(!revoking.has(gid), "授权正在撤销，请稍候", 409);
    revoking.add(gid);
    try {
      if (refreshing.has(gid)) await refreshing.get(gid).catch(() => {});
      const tokens = store.decrypt(g.tokens),
        c = store.decrypt(g.client),
        p = OAUTH_PROVIDERS[g.provider];
      const init = {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      };
      let revokeUrl = p.revoke;
      if (g.provider === "github") {
        revokeUrl = "https://api.github.com/applications/" + encodeURIComponent(c.clientId) + "/grant";
        init.method="DELETE";
        init.headers={Authorization:"Basic "+Buffer.from(c.clientId+":"+c.clientSecret).toString("base64"),"Content-Type":"application/json","User-Agent":"TapeNow",Accept:"application/vnd.github+json"};
        init.body=JSON.stringify({access_token:tokens.accessToken});
      } else if (g.provider === "vercel") {
        demand(g.configurationId, "请在 Vercel 后台撤销此集成",409);
        revokeUrl="https://api.vercel.com/v1/integrations/configuration/"+encodeURIComponent(g.configurationId);
        init.method="DELETE";
        init.headers={Authorization:"Bearer "+tokens.accessToken};
      } else if (g.provider === "supabase") {
        demand(tokens.refreshToken, "请在 Supabase 官方后台撤销此授权", 409);
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          refresh_token: tokens.refreshToken,
        });
      } else {
        init.headers = {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(c.clientId + ":" + c.clientSecret).toString("base64"),
        };
        init.body = new URLSearchParams({
          token: tokens.refreshToken || tokens.accessToken,
          token_type_hint: tokens.refreshToken
            ? "refresh_token"
            : "access_token",
        });
      }
      const res = await fetchImpl(revokeUrl, init);
      demand(
        res.ok,
        "供应商尚未确认撤销，授权保留以便重试；也可到官方后台撤销",
        502,
      );
      if (g.provider === "cloudflare" && tokens.refreshToken) {
        const second = await fetchImpl(p.revoke, {
          ...init,
          body: new URLSearchParams({
            token: tokens.accessToken,
            token_type_hint: "access_token",
          }),
        });
        demand(second.ok, "访问令牌尚未确认撤销，请重试", 502);
      }
      g.status = "revoked";
      for (const [key, c] of Object.entries(store.state.connections))
        if (c.grantId === gid) delete store.state.connections[key];
      delete store.state.oauthGrants[gid];
      store.save();
      return { revoked: true };
    } finally {
      revoking.delete(gid);
    }
  }
  return {
    status,
    start,
    callback,
    accessToken,
    resources,
    request,
    bind,
    credentials,
    revoke,
  };
}

export function mountOAuthRoutes(app, service, baseUrl) {
  app.get("/api/oauth", (req, res) =>
    res.set("Cache-Control", "no-store").json(service.status()),
  );
  app.post("/api/oauth/:provider/start", (req, res) => {
    const result = service.start(
      req.params.provider,
      req.protocol + "://" + req.get("host"),
      req.body,
    );
    res
      .set("Set-Cookie", result.cookie)
      .set("Cache-Control", "no-store")
      .json({ url: result.url });
  });
  app.get("/api/oauth/:provider/callback", async (req, res) => {
    const target = new URL(baseUrl);
    target.hash = "/~/storage";
    res.set("Cache-Control", "no-store");
    // Installing or changing repositories on GitHub returns here without our state. Nothing is
    // exchanged; the workbench reopens the connection so the repository list is read again.
    if (req.params.provider === "github" && !req.query.state && (req.query.installation_id || req.query.setup_action)) {
      target.searchParams.set("oauth", "installed");
      target.searchParams.set("provider", "github");
      return res.redirect(303, target.href);
    }
    try {
      const r = await service.callback(
        req.params.provider,
        req.query,
        req.headers.cookie,
      );
      res.set(
        "Set-Cookie",
        `${r.cookieName}=; HttpOnly; SameSite=Lax; Path=/api/oauth; Max-Age=0${baseUrl.startsWith("https:") ? "; Secure" : ""}`,
      );
      target.searchParams.set("oauth", r.cancelled ? "cancelled" : "connected");
      target.searchParams.set("provider", req.params.provider);
      if (r.grantId) target.searchParams.set("grant", r.grantId);
      if (r.projectId) target.searchParams.set("project", r.projectId);
      if (r.environment) target.searchParams.set("environment", r.environment);
    } catch (error) {
      console.warn("OAuth callback failed", {
        provider: req.params.provider,
        status: error.status,
        diagnostic: error.diagnostic,
      });
      target.searchParams.set("oauth", "error");
      target.searchParams.set("provider", req.params.provider);
      target.searchParams.set("reason", error.reason || "unknown");
    }
    res.redirect(303, target.href);
  });
  app.get("/api/oauth/grants/:gid/resources", async (req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json(await service.resources(req.params.gid)),
  );
  app.post("/api/oauth/grants/:gid/bind", async (req, res) =>
    res.json(await service.bind(req.params.gid, req.body)),
  );
  app.post("/api/oauth/grants/:gid/refresh", async (req, res) => {
    await service.accessToken(req.params.gid, true);
    res.json({ refreshed: true });
  });
  app.delete("/api/oauth/grants/:gid", async (req, res) =>
    res.json(await service.revoke(req.params.gid)),
  );
}
