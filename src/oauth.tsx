import { t, useLanguage, uiModel, translateMessage } from "./i18n";
import { useEffect, useState } from "react";
import { ArrowUpRight, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { api, date } from "./api";
import { Badge, Modal, Notice } from "./ui";
import type { Project } from "./types";
import type { ConnectService } from "./integrations";
import "./oauth.css";

type Provider = "cloudflare" | "supabase" | "github" | "vercel";
type Grant = {
  id: string;
  provider: Provider;
  label: string;
  status: string;
  createdAt: string;
  expiresAt: number | null;
  bindings: number;
};
type OAuthStatus = {
  providers: {
    provider: Provider;
    name: string;
    configured: boolean;
    callbackUrl: string;
    installUrl?: string;
    visibility?: "private" | "public";
  }[];
  grants: Grant[];
};
type Resource = { id: string; name: string; status: string; region?: string };
const names = uiModel({ cloudflare: "Cloudflare", supabase: "Supabase", github: "GitHub", vercel:"Vercel" });

export function OAuthAccounts({
  onConnect,
  onChanged,
  connectionVersion,
}: {
  onConnect: ConnectService;
  onChanged: () => void;
  connectionVersion: string;
}) {
 useLanguage();
  const [data, setData] = useState<OAuthStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [confirm, setConfirm] = useState("");
  const load = () =>
    api<OAuthStatus>("/oauth")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [connectionVersion]);
  async function revoke(g: Grant) {
    setBusy(g.id);
    setError("");
    try {
      await api("/oauth/grants/" + g.id, {}, "DELETE");
      setConfirm("");
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel oauth-accounts">
      <div className="panel-heading">
        <h2>
          <ShieldCheck size={18} /> {t("账户授权")}</h2>
        <Badge>OAuth</Badge>
      </div>
      <p className="muted">
        {t("授权后可将资源绑定到多个项目。移除项目连接保留账户授权；撤销授权会移除其所有项目连接。")}</p>
      {error && (
        <p role="alert" className="oauth-error">
          {translateMessage(error)}
        </p>
      )}
      {data?.grants.length ? (
        data.grants.map((g) => (
          <div className="oauth-account-row" key={g.id}>
            <div>
              <strong>
                {names[g.provider]} · {g.label}
              </strong>
              <small>
                {g.status === "authorized" ? t("已授权") : t("需要重新授权")} ·{" "}
                {g.bindings} {t("个项目连接 ·")}{date(g.createdAt)}
              </small>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={!!busy || g.status !== "authorized"}
                onClick={() => onConnect(g.provider, "")}
              >
                {t("选择资源")}</button>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => setConfirm(confirm === g.id ? "" : g.id)}
              >
                {t("撤销授权")}</button>
            </div>
            {confirm === g.id && (
              <div className="oauth-revoke-confirm">
                <p>
                  {t("撤销")}{names[g.provider]} {t("授权，并移除它在当前工作空间的")}{g.bindings}{" "}
                  {t("个连接。供应商项目、数据库和已发布的网站会保留。")}</p>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => setConfirm("")}
                >
                  {t("取消")}</button>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => void revoke(g)}
                >
                  {busy ? t("正在撤销…") : t("确认撤销")}
                </button>
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="muted">
          {t("尚未授权账户。点击服务的「连接」开始。")}</p>
      )}
    </section>
  );
}

export function OAuthConnect({
  provider,
  projects,
  projectId,
  environment,
  initialGrant,
  onClose,
  onManual,
  onConnected,
}: {
  provider: Provider;
  projects: Project[];
  projectId: string;
  environment: string;
  initialGrant?: string;
  onClose: () => void;
  onManual: () => void;
  onConnected: () => Promise<void>;
}) {
 useLanguage();
  const [data, setData] = useState<OAuthStatus | null>(null),
    [gid, setGid] = useState(initialGrant || ""),
    [rows, setRows] = useState<Resource[]>([]),
    [pid, setPid] = useState(projectId),
    [env, setEnv] = useState(environment),
    [rid, setRid] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [teamSlug, setTeamSlug] = useState(""),
    [busy, setBusy] = useState(""),
    [reload, setReload] = useState(0),
    [loadingResources, setLoadingResources] = useState(false);
  useEffect(() => {
    let active = true;
    api<OAuthStatus>("/oauth")
      .then((s) => {
        if (!active) return;
        setData(s);
        setGid(
          (g) =>
            g ||
            s.grants.find(
              (g) => g.provider === provider && g.status === "authorized",
            )?.id ||
            "",
        );
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [provider]);
  useEffect(() => {
    let active = true;
    setRows([]);
    setRid("");
    if (!gid) return;
    setLoadingResources(true);
    setError("");
    api<Resource[]>("/oauth/grants/" + gid + "/resources")
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoadingResources(false));
    return () => {
      active = false;
    };
  }, [gid, reload]);
  // Repository access is often changed on GitHub in another tab; re-read it on return.
  useEffect(() => {
    if (provider !== "github" || !gid) return;
    const again = () => document.visibilityState === "visible" && setReload((n) => n + 1);
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [provider, gid]);
  const configured = data?.providers.find(
    (p) => p.provider === provider,
  )?.configured;
  const privateApp = (provider === "github" || provider === "cloudflare") && data?.providers.find((p) => p.provider === provider)?.visibility === "private";
  const grants =
    data?.grants.filter(
      (g) => g.provider === provider && g.status === "authorized",
    ) || [];
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function authorize() {
    const result = await api<{ url: string }>("/oauth/" + provider + "/start", {
      projectId: pid,
      environment: env,
      ...(provider === "vercel" ? {teamSlug} : {}),
    });
    window.location.assign(result.url);
  }
  return (
    <Modal
      title={t("连接 ") + names[provider]}
      kicker="OAUTH · YOUR ACCOUNT, YOUR RESOURCES"
      onClose={onClose}
      busy={!!busy}
    >
      <div className="modal-form oauth-connect">
        <Notice>
          {t("在")}{names[provider]}{" "}
          {t("官方页面确认授权，密码始终由供应商管理。工作台将授权令牌加密保存在工作空间。")}</Notice>
        {provider === "supabase" ? (
          <p className="oauth-permissions">
            {t("申请 Projects / Organizations 读取权限与 Secrets 读取权限。后者包含 API keys 和其他项目秘密；工作台仅提取公开客户端 key，不读取业务数据，不申请数据库写权限。 在供应商取消授权后，若停留在其控制台，可返回本页面重试。")}</p>
        ) : provider === "github" ? <p className="oauth-permissions">{t("通过 GitHub App 选择可访问的仓库。构建在 GitHub Actions 内执行，使用仓库所有者的 Actions 额度。需要先安装 App 并放入构建流程。")}</p> : provider === "vercel" ? <p className="oauth-permissions">{t("仅读取获授权项目与部署信息。不会迁走原站、修改域名或自动复制秘密；GitHub 仓库需要单独连接。")}</p> : (
          <p className="oauth-permissions">
            {t("使用账户发现、Pages 与 Workers Scripts 权限完成部署；自定义域名可选申请 DNS 读写、区域读取和缓存清理权限。不申请账单权限。")}</p>
        )}
        {error && (
          <p role="alert" className="oauth-error">
            {translateMessage(error)}
          </p>
        )}
        {notice && (
          <p role="status" className="oauth-success">
            {translateMessage(notice)}
          </p>
        )}
        {!data ? (
          <p>{t("正在读取授权配置…")}</p>
        ) : !configured ? (
          <Notice>
            {t("工作空间尚未配置")}{names[provider]} {t("OAuth 应用。完成开发应用注册后即可授权，也可以使用手动连接。")}</Notice>
        ) : null}
        {privateApp && (
          <Notice>
            {t("当前授权应用仍为私有内测：")}{provider === "cloudflare"
              ? t("只有开发者 Cloudflare 账户的成员能完成 OAuth 授权。其他账户可使用自己的 Account ID 和限权 API Token 手动连接。")
              : t("只有应用所有者能安装 GitHub App。其他账户可使用自己仓库的限权 Token 手动连接，或先上传构建 ZIP 体验预览。")}
            {t("供应商取消授权后若没有自动返回，请重新打开 TapeNow。")}</Notice>
        )}
        {grants.length > 0 && (
          <label>
            {t("已授权账户")}<select value={gid} onChange={(e) => setGid(e.target.value)}>
              <option value="">{t("选择授权")}</option>
              {grants.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label} · {date(g.createdAt)}
                </option>
              ))}
            </select>
          </label>
        )}
        {provider === "vercel" && <>
          <small className="muted">{t("将在 Vercel 页面选择个人账户或团队，并只勾选需要导入的项目。完成后会回到 TapeNow。")}</small>
          <details className="oauth-advanced">
            <summary>{t("没有回到 TapeNow？")}</summary>
            <p className="muted">{t("请使用 Safari 普通窗口（不要用无痕浏览），并允许 vercel.com 弹出窗口。仍不行时，可填写团队网址标识，改用 Vercel 团队控制台授权。")}</p>
            <label>{t("Vercel 团队网址标识（可选）")}<input value={teamSlug} onChange={e=>setTeamSlug(e.target.value.trim().toLowerCase())} placeholder={t("例如 my-team")} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}/><small className="muted">{t("在 Vercel 控制台网址 vercel.com/团队标识 中查看。")}</small></label>
          </details>
        </>}
        <button
          type="button"
          className="button primary oauth-authorize"
          disabled={!configured || !!busy || (provider === "vercel" && !!teamSlug && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(teamSlug))}
          onClick={() => void run(t("正在跳转…"), authorize)}
        >
          <ArrowUpRight size={17} />
          {busy === t("正在跳转…")
            ? busy
            : grants.length
              ? t("授权另一个账户")
              : t("前往 ") + names[provider] + t(" 授权")}
        </button>
        {provider === "github" && data?.providers.find(p=>p.provider==="github")?.installUrl && <a className="button secondary" href={data.providers.find(p=>p.provider==="github")!.installUrl} target="_blank" rel="noreferrer">{t("安装 App / 调整仓库权限")}</a>}
        {gid && (
          <>
            <div className="oauth-divider">{t("选择资源并绑定")}</div>
            <label>
              {provider === "cloudflare" ? t("Cloudflare 账户") : provider === "github" ? t("GitHub 仓库") : names[provider]+t(" 项目")}
              <select
                value={rid}
                disabled={loadingResources || !!busy}
                onChange={(e) => setRid(e.target.value)}
              >
                <option value="">
                  {loadingResources ? t("读取中…") : t("选择资源")}
                </option>
                {rows.map((r) => (
                  <option
                    key={r.id}
                    value={r.id}
                    disabled={
                      provider === "supabase" && r.status !== "ACTIVE_HEALTHY"
                    }
                  >
                    {r.name}
                    {r.region ? " · " + r.region : ""}
                    {provider === "supabase" && r.status !== "ACTIVE_HEALTHY"
                      ? t(" · 暂不可用（") + r.status + "）"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            {!loadingResources && rows.length === 0 && !error && (
              <small className="muted">
                {provider === "github"
                  ? t("还没有可选仓库。请点击「安装 App / 调整仓库权限」，在 GitHub 选择仓库后回到这里。")
                  : t("此授权没有可用资源。请先在供应商后台创建项目，再重新打开连接窗口。")}</small>
            )}
            <button type="button" className="text-button" disabled={loadingResources || !!busy} onClick={() => setReload((n) => n + 1)}>
              <RefreshCw size={14} />
              {t("刷新列表")}</button>
            {provider === "supabase" &&
              rows.some((r) => r.status !== "ACTIVE_HEALTHY") && (
                <Notice>
                  {t("暂停或未就绪的项目可被发现，但需要先在 Supabase 恢复运行，才能验证连接。")}</Notice>
              )}
            <label>
              {t("所属项目")}<select value={pid} onChange={(e) => setPid(e.target.value)}>
                <option value="">{t("选择工作台项目")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("环境")}<select value={env} onChange={(e) => setEnv(e.target.value)}>
                <option value="preview">{t("预览环境")}</option>
                {!["github","vercel"].includes(provider) && <option value="production">{t("生产环境")}</option>}
              </select>
            </label>
            <button
              type="button"
              className="button primary"
              disabled={!rid || !pid || !!busy || loadingResources}
              onClick={() =>
                void run(t("验证并连接"), async () => {
                  await api("/oauth/grants/" + gid + "/bind", {
                    projectId: pid,
                    environment: env,
                    resourceId: rid,
                  });
                  await onConnected();
                  onClose();
                })
              }
            >
              <ShieldCheck size={16} />
              {busy === t("验证并连接") ? t("正在验证…") : t("验证并连接")}
            </button>
            {provider !== "vercel" && <button
              type="button"
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void run(t("验证续期"), async () => {
                  await api("/oauth/grants/" + gid + "/refresh", {});
                  setNotice(t("授权已成功续期。"));
                })
              }
            >
              <RefreshCw size={14} />
              {t("验证授权续期")}</button>}
          </>
        )}
        <div className="modal-actions">
          {provider !== "vercel" && <button
            type="button"
            className="text-button"
            onClick={onManual}
            disabled={!!busy}
          >
            <KeyRound size={14} />
            {t("使用手动凭据")}</button>}
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={!!busy}
          >
            {t("关闭")}</button>
        </div>
      </div>
    </Modal>
  );
}
