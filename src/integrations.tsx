import { t, useLanguage, uiModel, translateMessage } from "./i18n";
import {DataHealth} from "./batch2";
import {
  ArrowRight,
  ChevronRight,
  Cloud,
  Database,
  GitBranch,
  Hexagon,
  Plug,
  Plus,
  Trash2,
} from "lucide-react";
import type { Connection, Project, Release, State } from "./types";
import { Badge, Empty, External, Notice } from "./ui";
import { date } from "./api";
import { OAuthAccounts } from "./oauth";

export const providers = uiModel([
  {id:"vercel",name:"Vercel",icon:ArrowRight,color:"lilac",description:"导入现有项目，检查兼容性并重新构建。",detail:"读取项目与部署；GitHub 源码需要单独授权。",keywords:"vercel 导入 import 迁移"},
  {
    id: "cloudflare",
    name: "Cloudflare",
    icon: Cloud,
    color: "peach",
    description: "公开预览、生产镜像与域名分发。",
    detail: "连接自己的 Cloudflare Pages 账号。",
    keywords: "cf cloudflare 预览 发布 域名 CDN",
  },
  {
    id: "supabase",
    name: "Supabase",
    icon: Database,
    color: "mint",
    description: "为应用连接登录与数据库服务。",
    detail: "授权后选择项目，或使用公开客户端配置。",
    keywords: "supabase 数据库 database auth PostgreSQL postgres 存储",
  },
  {
    id: "github",
    name: "GitHub",
    icon: GitBranch,
    color: "lilac",
    description: "从 Actions 导入已完成的构建。",
    detail: "关联仓库、构建产物与提交记录。",
    keywords: "github git 仓库 repository actions 构建",
  },
] as const);
export type Provider = (typeof providers)[number]["id"];
export type ConnectService = (
  provider: Provider,
  projectId?: string,
  environment?: string,
) => void;
export type ManageService = (
  provider: Provider | "chain",
  projectId: string,
) => void;

export function IntegrationsPage({
  data,
  project,
  busy,
  onConnect,
  onManage,
  onDisconnect,
  onChanged,
  onCreate,
}: {
  data: State;
  project?: Project;
  busy: boolean;
  onConnect: ConnectService;
  onManage: ManageService;
  onDisconnect: (key: string) => void;
  onChanged: () => void;
  onCreate: () => void;
}) {
 useLanguage();
  const connections = Object.entries(data.connections).filter(
    ([, c]) =>
      providers.some((p) => p.id === c.provider) &&
      (!project || c.projectId === project.id),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{project ? t("服务集成") : t("集成")}</h1>
          <p>
            {project
              ? t("连接已有服务，在项目中管理构建、数据和交付。")
              : t("查看所有项目的服务连接，或为一个项目接入新的服务。")}
          </p>
        </div>
      </div>
      <div className="integrations-layout">
        <div className="provider-grid">
          {providers.map((p) => {
            const linked = connections.filter(([, c]) => c.provider === p.id);
            return (
              <section
                className="panel provider-card"
                key={p.id}
                data-provider={p.id}
              >
                <div className={"provider-icon " + p.color}>
                  <p.icon size={23} />
                </div>
                <h2>{p.name}</h2>
                <p>{p.description}</p>
                <small>{translateMessage(p.detail)}</small>
                <div className="provider-card-bottom">
                  <Badge tone={linked.length ? "teal" : "neutral"}>
                    {linked.length ? t("{0} 个连接", [linked.length]) : t("未连接")}
                  </Badge>
                  <button
                    className="button secondary"
                    disabled={project?.role==='viewer'||(busy)}
                    onClick={() =>
                      data.projects.length
                        ? onConnect(p.id, project?.id)
                        : onCreate()
                    }
                  >
                    {data.projects.length ? t("连接") : t("创建项目")}
                    <Plus size={14} />
                  </button>
                </div>
              </section>
            );
          })}
        </div>
        <OAuthAccounts
          onConnect={onConnect}
          onChanged={onChanged}
          connectionVersion={JSON.stringify(
            Object.entries(data.connections).map(([key, c]) => [
              key,
              c.grantId,
              c.status,
              c.checkedAt,
            ]),
          )}
        />
        <section className="panel connections-table">
          <div className="panel-heading">
            <h2>{project ? t("项目连接") : t("各项目的连接")}</h2>
            <Badge>{connections.length}</Badge>
          </div>
          {connections.length ? (
            connections.map(([key, c]) => {
              const p = providers.find((p) => p.id === c.provider)!;
              return (
                <div
                  className="connection-row service-connection-row"
                  key={key}
                >
                  <span className="connection-logo">
                    <p.icon size={18} />
                  </span>
                  <div className="connection-description">
                    <strong>
                      {p.name} · {c.label}
                    </strong>
                    {!project && (
                      <small>
                        {data.projects.find((p) => p.id === c.projectId)
                          ?.name || t("未知项目")}
                      </small>
                    )}
                    <small>{translateMessage(c.detail)}</small>
                    <small>{t("上次验证：")}{date(c.checkedAt)}</small>
                  </div>
                  <Badge>
                    {c.environment === "preview"
                      ? c.provider === "github"
                        ? t("构建来源")
                        : t("预览")
                      : t("生产")}
                  </Badge>
                  <button
                    className="button secondary"
                    onClick={() => onManage(p.id, c.projectId)}
                  >
                    {t("管理")}</button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={t("移除 {0} {1} 连接", [p.name,c.environment])}
                    onClick={() => onDisconnect(key)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })
          ) : (
            <Empty icon={<Plug />} title={t("连接你的第一个服务")}>
              {t("选择 Cloudflare 分享网站，使用 Supabase 连接应用数据，或从 GitHub 导入构建。连接会归属到你选择的项目。")}</Empty>
          )}
        </section>
        <div className="split-panels">
          <section className="panel info-panel">
            <h3>{t("连接一次，回到对应功能继续")}</h3>
            <p>
              {t("GitHub 在「设置 → Git」管理构建来源；Supabase 在「存储与数据」管理；Cloudflare 在「设置 → 构建与部署」配置，具体发布在部署详情执行。")}</p>
            <div className="button-row">
              {project &&
                providers.map((p) => (
                  <button
                    key={p.id}
                    className="text-button"
                    onClick={() => onManage(p.id, project.id)}
                  >
                    {p.name}
                    <ArrowRight size={14} />
                  </button>
                ))}
            </div>
          </section>
          <section className="panel info-panel">
            <h3>{t("账号与数据仍由你掌握")}</h3>
            <p>
              {t("当前连接按项目保存。移除连接会删除工作台保存的凭证，不会删除供应商资源，也不会撤销已发布网站中的公开配置。连接验证记录不代表持续监控或完整发布验收。")}</p>
          </section>
        </div>
      </div>
    </>
  );
}

function EnvironmentConnection({
  provider,
  environment,
  project,
  connection,
  busy,
  onConnect,
}: {
  provider: Provider;
  environment: string;
  project: Project;
  connection?: Connection;
  busy: boolean;
  onConnect: ConnectService;
}) {
 useLanguage();
  const info = providers.find((p) => p.id === provider)!;
  return (
    <section
      className="panel environment-connection"
      data-environment={environment}
    >
      <div className="panel-heading">
        <h2>{environment === "preview" ? t("预览环境") : t("生产环境")}</h2>
        <Badge tone={connection ? "teal" : "neutral"}>
          {connection ? t("连接已验证") : t("未连接")}
        </Badge>
      </div>
      <div className="service-panel-body">
        <info.icon size={22} />
        <strong>{connection?.label || t("连接 {0}", [info.name])}</strong>
        <p>
          {connection?.detail ||
            (environment === "preview"
              ? t("用于测试与分享，建议使用独立的测试资源。")
              : t("用于正式环境，请明确选择相应账号或项目。"))}
        </p>
        {connection && (
          <small className="muted">
            {t("上次验证：")}{date(connection.checkedAt)}
          </small>
        )}
      </div>
      <div className="panel-footer">
        <button
          className="button secondary"
          disabled={project?.role==='viewer'||(busy)}
          onClick={() => onConnect(provider, project.id, environment)}
        >
          {connection ? t("更新连接") : t("连接 {0}", [info.name])}
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

export function StoragePage({
  data,
  project,
  busy,
  onConnect,
  onIntegrations,
  onChanged,
}: {
  data: State;
  project: Project;
  busy: boolean;
  onConnect: ConnectService;
  onIntegrations: () => void;
  onChanged: () => Promise<unknown>;
}) {
 useLanguage();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("存储与数据")}</h1>
          <p>{t("连接你自己的 Supabase，为网站提供登录和业务数据。")}</p>
        </div>
        <button className="button secondary" onClick={onIntegrations}>
          {t("管理全部连接")}<ArrowRight size={14} />
        </button>
      </div>
      <div className="service-environments">
        {["preview", "production"].map((environment) => (
          <EnvironmentConnection
            key={environment}
            provider="supabase"
            environment={environment}
            project={project}
            connection={
              data.connections[`${project.id}:supabase:${environment}`]
            }
            busy={busy}
            onConnect={onConnect}
          />
        ))}
      </div>
      <DataHealth project={project} onChanged={onChanged}/>
      <section className="panel info-panel data-next-steps">
        <h3>{t("连接之后，网站怎样使用数据库？")}</h3>
        <ol>
          <li>
            {t("网站代码调用自己的 Supabase 接口，连接工作台不会自动改写网站。")}</li>
          <li>
            {t("配套示例可以明确选择预览或生产环境的公开配置。审查并运行示例 SQL 后，再导入一个新的示例版本。")}</li>
          <li>
            {t("正式发布前，在自己的构建中指定生产配置，验证业务表和访问权限。")}</li>
        </ol>
        <div className="button-row">
          <External href="/docs/supabase-demo.sql" className="text-button">
            {t("查看示例表与访问策略")}</External>
          <External
            href="https://supabase.com/dashboard"
            className="text-button"
          >
            {t("打开 Supabase 控制台")}</External>
        </div>
      </section>
      <Notice>
        {t("Supabase 连接检测仅确认 Auth API 可达；业务表、RLS 与登录流程需要独立测试。普通 PostgreSQL 可在上方单独连接，验证 TLS 与只读权限。云端构建归档在 R2，本地归档在本机，与业务数据库分开。")}</Notice>
    </>
  );
}

export function GitSettings({
  data,
  project,
  busy,
  onConnect,
  onImport,
}: {
  data: State;
  project: Project;
  busy: boolean;
  onConnect: ConnectService;
  onImport: () => void;
}) {
 useLanguage();
  const connection = data.connections[`${project.id}:github:preview`];
  return (
    <section
      className="panel settings-panel service-settings"
      data-service-settings="github"
    >
      <div className="panel-heading">
        <h2>{t("Git 仓库")}</h2>
        <Badge tone={connection ? "teal" : "neutral"}>
          {connection ? t("仓库已连接") : t("未连接")}
        </Badge>
      </div>
      <div className="service-panel-body">
        <GitBranch size={22} />
        <strong>{connection?.label || t("从 GitHub 开始")}</strong>
        <p>
          {connection?.detail ||
            t("连接已有静态网站仓库，将 Actions 构建产物导入为独立版本。")}
        </p>
        <dl className="service-facts">
          <div>
            <dt>{t("构建方式")}</dt>
            <dd>GitHub Actions</dd>
          </div>
          <div>
            <dt>{t("产物名称")}</dt>
            <dd>
              <code>deweb-dist</code>
            </dd>
          </div>
          <div>
            <dt>{t("分支与构建命令")}</dt>
            <dd>{t("在仓库 workflow 中配置")}</dd>
          </div>
          <div>
            <dt>{t("同步方式")}</dt>
            <dd>{t("手动拉取最近产物，不会自动发布或签署交易")}</dd>
          </div>
        </dl>
        <External href="/docs/github-workflow.yml" className="text-button">
          {t("查看 GitHub workflow")}</External>
        <p>
          {t("先将 workflow 放入仓库并完成构建，再拉取产物。每次导入会保留提交 SHA 与文件清单；公开预览和正式发布在部署详情继续。")}</p>
        {connection && (
          <small className="muted">
            {t("上次验证：")}{date(connection.checkedAt)}
          </small>
        )}
      </div>
      <div className="settings-footer">
        <button
          className="button secondary"
          disabled={project?.role==='viewer'||(busy)}
          onClick={() => onConnect("github", project.id)}
        >
          {connection ? t("更新仓库连接") : t("连接 GitHub")}
        </button>
        <button
          className="button primary"
          disabled={busy || !connection}
          onClick={onImport}
        >
          {t("拉取最近构建")}<ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

export function DeliverySettings({
  data,
  project,
  busy,
  onConnect,
  onRelease,
  onImport,
  onGit,
}: {
  data: State;
  project: Project;
  busy: boolean;
  onConnect: ConnectService;
  onRelease: (r: Release) => void;
  onImport: () => void;
  onGit: () => void;
}) {
 useLanguage();
  const release =
    data.releases.find((r) => r.id === project.productionId) ||
    data.releases.find((r) => r.projectId === project.id);
  return (
    <div className="delivery-settings" data-service-settings="cloudflare">
      <section className="panel info-panel">
        <h3>{t("构建与部署")}</h3>
        <p>
          {t("上传已经构建好的 ZIP / 目录，或从 GitHub Actions 导入固定产物。公开预览和生产镜像由下面选择的 Cloudflare 账号提供。")}</p>
        <div className="button-row">
          <button className="button secondary" onClick={onImport}>
            {t("上传构建包")}</button>
          <button className="button secondary" onClick={onGit}>
            {t("管理 GitHub 构建")}<ArrowRight size={14} />
          </button>
        </div>
      </section>
      <div className="service-environments">
        {["preview", "production"].map((environment) => (
          <EnvironmentConnection
            key={environment}
            provider="cloudflare"
            environment={environment}
            project={project}
            connection={
              data.connections[`${project.id}:cloudflare:${environment}`]
            }
            busy={busy}
            onConnect={onConnect}
          />
        ))}
      </div>
      <section className="panel info-panel">
        <h3>{t("选择版本，再执行发布")}</h3>
        <p>
          {t("每个版本分别记录公开预览、生产镜像和 X Layer 发布状态。配置账号不会自动发布；生产镜像与链上文件需要各自核验。")}</p>
        <button
          className="button primary"
          onClick={() => (release ? onRelease(release) : onImport())}
        >
          {release ? t("打开部署详情") : t("导入第一个版本")}
          <ArrowRight size={14} />
        </button>
      </section>
    </div>
  );
}

export function ProjectConnections({
  data,
  project,
  onManage,
  onAll,
}: {
  data: State;
  project: Project;
  onManage: ManageService;
  onAll: () => void;
}) {
 useLanguage();
  return (
    <section className="panel project-connections" aria-label={t("项目连接")}>
      <div className="panel-heading">
        <h2>{t("项目连接")}</h2>
        <button className="text-button" onClick={onAll}>
          {t("管理集成")}<ArrowRight size={14} />
        </button>
      </div>
      <div className="project-connection-grid">
        {providers.map((p) => {
          const connections = Object.values(data.connections).filter(
            (c) => c.projectId === project.id && c.provider === p.id,
          );
          const status = connections.length
            ? connections
                .map((c) =>
                  p.id === "github" && c.environment === "preview"
                    ? t("构建来源已连接")
                    : t("{0}已连接", [c.environment === "preview" ? "预览" : "生产"]),
                )
                .join(" · ")
            : t("未连接");
          return (
            <button
              key={p.id}
              className="project-service"
              onClick={() => onManage(p.id, project.id)}
            >
              <p.icon size={19} />
              <span>
                <strong>{p.name}</strong>
                <small>{status}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          );
        })}
        <button
          className="project-service"
          onClick={() => onManage("chain", project.id)}
        >
          <Hexagon size={19} />
          <span>
            <strong>X Layer</strong>
            <small>
              {project.chain.cpuIndex && project.chain.tokenId
                ? t("发布目标已设置")
                : t("未设置发布目标")}
            </small>
          </span>
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}
