import { t, useLanguage, uiModel, translateMessage } from "./i18n";
import {isCloud} from "./api";
import { useState, type RefObject } from "react";
import {
  Search,
  Plus,
  LayoutGrid,
  List,
  ArrowUpRight,
  ArrowRight,
  GitBranch,
  Layers,
  HardDrive,
  Activity,
  BookOpen,
  Globe,
  Hexagon,
  CheckCircle2,
  RotateCcw,
  ChevronRight,
  Upload,
  Plug,
} from "lucide-react";
import type { State, Project, Release } from "./types";
import { bytes, date, preview, short } from "./api";
import {
  Badge,
  Empty,
  External,
  WebsitePreview,
  ReleaseStatus as Status,
} from "./ui";
import { ProjectJourney, type GuideSection, type GuideTopic } from "./guide";
import {
  ProjectConnections,
  providers,
  type ManageService,
} from "./integrations";

export const sourceName: Record<string, string> = uiModel({
  vercel: "Vercel 导入",
  sample: "示例构建",
  upload: "本地上传",
  "chain-import": "链上站点归档",
  github: "GitHub Actions",
  restore: "归档恢复",
  rollback: "归档恢复",
});
export function DeploymentList({
  items,
  data,
  onOpen,
}: {
  items: Release[];
  data: State;
  onOpen: (r: Release) => void;
}) {
 useLanguage();
  return (
    <section className="panel deployment-list" aria-label={t("部署列表")}>
      {items.length ? (
        items.map((r) => (
          <button
            className="deployment-row"
            key={r.id}
            onClick={() => onOpen(r)}
          >
            <span className="deployment-name">
              <strong>{r.label}</strong>
              <code>{short(r.id, 14)}</code>
            </span>
            <Status
              r={r}
              current={
                r.id ===
                data.projects.find((p) => p.id === r.projectId)?.productionId
              }
            />
            <span className="deployment-size">
              {bytes(r.bytes)}
              <small>{r.files.length} {t("个文件")}</small>
            </span>
            <span className="deployment-source">
              <GitBranch size={14} />
              <span>
                {sourceName[r.source.type] || r.source.type}
                <small>
                  {r.source.commit
                    ? short(r.source.commit, 7)
                    : data.projects.find((p) => p.id === r.projectId)?.name}
                </small>
              </span>
              {r.restoredFrom && <RotateCcw size={13} />}
            </span>
            <time>{date(r.createdAt)}</time>
            <ChevronRight size={14} />
          </button>
        ))
      ) : (
        <Empty icon={<Layers />} title={t("没有匹配的部署")}>
          {t("导入构建或调整筛选条件后再试。")}</Empty>
      )}
    </section>
  );
}

export function WorkspaceHome({
  data,
  view,
  search,
  onSearch,
  searchRef,
  onCreate,
  onProject,
  onRelease,
  onGuide,
  onView,
  logLevel,
}: {
  data: State;
  view: string;
  logLevel: string;
  search: string;
  onSearch: (s: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onCreate: () => void;
  onProject: (p: Project) => void;
  onRelease: (r: Release) => void;
  onGuide: (section?: GuideSection, topic?: GuideTopic) => void;
  onView: (view: "deployments" | "logs" | "usage" | "storage") => void;
}) {
 useLanguage();
  const [layout, setLayout] = useState("grid");
  const [sort, setSort] = useState("updated");
  const [status, setStatus] = useState("all");
  const projects = data.projects
    .filter((p) =>
      (p.name + " " + p.description)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const totalBytes = data.releases.reduce((sum, r) => sum + (r.archive?.state==='purged'?0:r.bytes), 0);
  const recent = data.releases.slice(0, 4);
  const releases = data.releases.filter(
    (r) =>
      (
        r.label +
        " " +
        r.id +
        " " +
        (data.projects.find((p) => p.id === r.projectId)?.name || "")
      )
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "all" ||
        (status === "chain"
          ? r.chainStatus === "verified"
          : data.projects.some((p) => p.productionId === r.id))),
  );
  if (view === "deployments")
    return (
      <>
        <div className="page-heading">
          <h1>{t("部署")}</h1>
        </div>
        <div className="section-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label={t("搜索部署")}
              placeholder={t("搜索部署或项目…")}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <select
            aria-label={t("部署筛选")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{t("所有部署")}</option>
            <option value="current">{t("当前版本")}</option>
            <option value="chain">{t("链上已核验")}</option>
          </select>
        </div>
        <DeploymentList items={releases} data={data} onOpen={onRelease} />
        <p className="table-note">
          {t("所有项目的部署记录。选择一条记录查看预览、文件和发布状态。")}</p>
      </>
    );
  if (view === "logs")
    return (
      <>
        <div className="section-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label={t("搜索日志")}
              placeholder={t("搜索活动日志…")}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </div>
        <section className="panel log-panel">
          <div className="log-header">
            <span>{t("时间")}</span>
            <span>{t("级别")}</span>
            <span>{t("事件")}</span>
          </div>
          {data.logs
            .filter(
              (l) =>
                l.message.toLowerCase().includes(search.toLowerCase()) &&
                (logLevel === "all" || l.level === logLevel),
            )
            .map((l) => (
              <div className="log-row" key={l.id}>
                <time>{date(l.at)}</time>
                <Badge
                  tone={
                    l.level === "error"
                      ? "coral"
                      : l.level === "success"
                        ? "teal"
                        : "neutral"
                  }
                >
                  {l.level}
                </Badge>
                <div>
                  {translateMessage(l.message)}
                  {l.releaseId && (
                    <button
                      className="log-release"
                      onClick={() => {
                        const r = data.releases.find(
                          (r) => r.id === l.releaseId,
                        );
                        if (r) onRelease(r);
                      }}
                    >
                      {l.releaseId}
                    </button>
                  )}
                </div>
              </div>
            ))}
        </section>
        <p className="table-note">
          {t("这里只记录工作台操作，应用运行时日志尚未接入。")}</p>
      </>
    );
  if (view === "usage")
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{t("用量")}</h1>
            <p>{t("当前工作空间的资源记录。")}</p>
          </div>
          <Badge>{t("工作台记录")}</Badge>
        </div>
        <div className="stats-grid">
          {[
            [t("归档文件总量"), bytes(totalBytes), t("包含回收站，排除已清除文件")],
            [
              t("部署版本"),
              String(data.releases.length),
              t("{0} 个项目", [data.projects.length]),
            ],
            [
              t("预览页面请求"),
              isCloud() ? t("见项目诊断") : String(data.visits.length),
              isCloud() ? t("各项目入口统计分别查看") : t("最近 2,000 条全工作区记录范围"),
            ],
          ].map(([label, value, desc]) => (
            <section className="panel stat-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{desc}</small>
            </section>
          ))}
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>{t("项目存储分布")}</h2>
          </div>
          {data.projects.map((p) => (
            <button
              key={p.id}
              className="usage-project"
              onClick={() => onProject(p)}
            >
              <Hexagon size={16} />
              <span>{p.name}</span>
              <code>
                {bytes(
                  data.releases
                    .filter((r) => r.projectId === p.id)
                    .reduce((s, r) => s + (r.archive?.state==='purged'?0:r.bytes), 0),
                )}
              </code>
              <ChevronRight size={14} />
            </button>
          ))}
        </section>
        <p className="table-note">
          {t("不包含链上、Cloudflare 或数据库账单。实际费用以各供应商账号和钱包为准。")}</p>
      </>
    );
  return (
    <div className="workspace-console">
      <div className="workspace-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            ref={searchRef}
            aria-label={t("搜索项目")}
            placeholder={t("搜索项目…")}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>
        <select
          aria-label={t("项目排序")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="updated">{t("最近更新")}</option>
          <option value="name">{t("按名称")}</option>
        </select>
        <div className="view-switch" role="group" aria-label={t("项目展示方式")}>
          <button
            aria-label={t("卡片视图")}
            aria-pressed={layout === "grid"}
            onClick={() => setLayout("grid")}
          >
            <LayoutGrid size={17} />
          </button>
          <button
            aria-label={t("列表视图")}
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
          >
            <List size={18} />
          </button>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={15} />
          {t("新建项目")}</button>
      </div>
      <div className="workspace-columns">
        <aside className="workspace-insights">
          <div className="section-title">
            <h2>{t("用量")}</h2>
            <button
              className="text-button"
              onClick={() => onView("usage")}
              aria-label={t("查看所有用量")}
            >
              <ArrowUpRight size={15} />
            </button>
          </div>
          <section className="panel usage-summary">
            <div className="mini-panel-title">
              <span>{isCloud() ? t("云端工作空间") : t("本地工作空间")}</span>
              <Badge>Preview</Badge>
            </div>
            {[
              [HardDrive, t("归档存储"), bytes(totalBytes)],
              [Layers, t("部署版本"), String(data.releases.length)],
              [Activity, t("预览请求"), isCloud() ? t("见项目诊断") : String(data.visits.length)],
            ].map(([Icon, label, value]) => {
              const I = Icon as typeof Layers;
              return (
                <div className="usage-line" key={String(label)}>
                  <I size={15} />
                  <span>{String(label)}</span>
                  <code>{String(value)}</code>
                </div>
              );
            })}
            <p>{isCloud() ? t("此处展示账户归档占用；入口统计请打开各项目的「用量与诊断」。") : t("请求计数来自最近 2,000 条工作区记录。")}</p>
          </section>
          <div className="section-title">
            <h2>{t("开始使用")}</h2>
          </div>
          <section className="panel workspace-help">
            <BookOpen size={23} />
            <strong>{t("从一个构建，到第一次发布")}</strong>
            <p>{t("导入网站、创建私有预览，再选择你的公开发布方式。")}</p>
            <button
              className="button secondary"
              onClick={() => onGuide("start")}
            >
              {t("打开使用指南")}<ArrowRight size={14} />
            </button>
          </section>
          <div className="section-title">
            <h2>{t("服务连接")}</h2>
            <button
              className="text-button"
              onClick={() => onView("storage")}
              aria-label={t("查看所有集成")}
            >
              <ArrowUpRight size={15} />
            </button>
          </div>
          <section className="panel workspace-connections">
            {providers.map((p) => {
              const count = Object.values(data.connections).filter(
                (c) => c.provider === p.id,
              ).length;
              return (
                <button key={p.id} onClick={() => onView("storage")}>
                  <p.icon size={16} />
                  <span>{p.name}</span>
                  <small>{count ? t("{0} 个连接", [count]) : t("未连接")}</small>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </section>
          <div className="section-title">
            <h2>{t("最近预览")}</h2>
            <button
              className="text-button"
              onClick={() => onView("deployments")}
              aria-label={t("查看所有部署")}
            >
              <ArrowUpRight size={15} />
            </button>
          </div>
          <section className="panel recent-previews">
            {recent.length ? (
              recent.map((r) => (
                <div className="recent-preview" key={r.id}>
                  <button onClick={() => onRelease(r)}>
                    <span className="project-glyph">
                      <Hexagon size={15} />
                    </span>
                    <strong>{r.label}</strong>
                    <span>
                      {data.projects.find((p) => p.id === r.projectId)?.name}
                    </span>
                  </button>
                  <div>
                    <External
                      href={preview(r.projectId, r.id)}
                      className="preview-chip"
                    >
                      {t("预览")}</External>
                    <button
                      className="preview-chip"
                      onClick={() => onRelease(r)}
                    >
                      <span className="ready-dot" />
                      {short(r.id, 12)}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="compact-empty">{t("导入构建并创建预览后，入口会显示在这里。")}</p>
            )}
          </section>
        </aside>
        <section className="workspace-projects">
          <div className="section-title">
            <h1>
              {t("项目")}<span className="muted">{projects.length}</span>
            </h1>
          </div>
          <div
            className={
              "console-project-grid " + (layout === "list" ? "is-list" : "")
            }
          >
            {projects.map((p, i) => {
              const current = data.releases.find(
                (r) => r.id === p.productionId,
              );
              const latest =
                current || data.releases.find((r) => r.projectId === p.id);
              return (
                <article className="console-project-card" key={p.id}>
                  <button
                    className="project-card-main"
                    onClick={() => onProject(p)}
                  >
                    <span className={"project-glyph color-" + (i % 3)}>
                      <Hexagon size={21} />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {current
                          ? t("当前版本 · ") + current.label
                          : t("尚未设置当前版本")}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  {latest ? (
                    <button
                      className="project-card-release"
                      onClick={() => onRelease(latest)}
                    >
                      <GitBranch size={14} />
                      <span>{latest.label}</span>
                      <span
                        className={
                          "ready-dot " +
                          (latest.chainStatus === "verified" ? "verified" : "")
                        }
                        title={
                          latest.chainStatus === "verified"
                            ? t("链上已核验")
                            : t("构建归档就绪")
                        }
                      />
                    </button>
                  ) : (
                    <button
                      className="project-card-release text-button"
                      onClick={() => onProject(p)}
                    >
                      {t("导入第一次构建")}<ArrowRight size={14} />
                    </button>
                  )}
                  <div className="project-card-meta">
                    <Layers size={13} />
                    <span>
                      {latest
                        ? sourceName[latest.source.type] || latest.source.type
                        : t("等待部署")}
                    </span>
                    <span>·</span>
                    <time>{date(latest?.createdAt || p.createdAt)}</time>
                  </div>
                </article>
              );
            })}
          </div>
          {!projects.length && (
            <Empty
              icon={<Search />}
              illustration={search ? undefined : "project"}
              title={search ? t("没有匹配的项目") : t("创建你的第一个项目")}
              action={
                <button
                  className="button secondary"
                  onClick={search ? () => onSearch("") : onCreate}
                >
                  {search ? t("清除搜索") : t("新建项目")}
                </button>
              }
            >
              {search
                ? t("试试其他项目名称。")
                : t("上传已构建的网站，或从免费示例开始。")}
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}

export function ProjectOverview({
  project,
  data,
  releases,
  production,
  onImport,
  onRelease,
  onNavigate,
  onManageService,
  onGuide,
}: {
  project: Project;
  data: State;
  releases: Release[];
  production?: Release;
  onImport: () => void;
  onRelease: (r: Release) => void;
  onNavigate: (
    view: "deployments" | "settings" | "storage" | "domains" | "usage" | "data",
  ) => void;
  onManageService: ManageService;
  onGuide: () => void;
}) {
 useLanguage();
  const connections = Object.values(data.connections).filter(
    (c) => c.projectId === project.id && c.provider !== "secret",
  );
  const domains = data.domains.filter((d) => d.projectId === project.id);
  return (
    <>
      <section className="panel production-panel">
        <div className="panel-heading">
          <h1>
            {t("当前部署")}<span className="label-outline">{isCloud() ? "CLOUD" : "LOCAL"}</span>
          </h1>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => onNavigate("deployments")}
            >
              <RotateCcw size={14} />
              {t("版本历史")}</button>
            {production && <External href={preview(project.id)}>{t("访问")}</External>}
            <button className="button primary" onClick={onImport}>
              <Plus size={14} />
              {t("导入构建")}</button>
          </div>
        </div>
        {production ? (
          <>
            <div className="production-body">
              <WebsitePreview
                href={preview(project.id)}
                locked={isCloud()&&production.privatePreview?.status==="active"}
                unpublished={isCloud()&&!production.preview?.url&&!production.site?.url&&production.gateway?.status!=="active"&&production.privatePreview?.status!=="active"}
                title={t("当前版本网站缩略图")}
                label={t("打开当前版本预览")}
              />
              <div className="production-metadata">
                <div>
                  <span className="field-label">{t("部署")}</span>
                  <button
                    className="text-button"
                    onClick={() => onRelease(production)}
                  >
                    {production.label}
                    <ArrowUpRight size={14} />
                  </button>
                  <code>{production.id}</code>
                </div>
                <div>
                  <span className="field-label">{t("域名")}</span>
                  {domains.length ? (
                    domains.map((d) => (
                      <button
                        key={d.id}
                        className="text-button"
                        onClick={() => onNavigate("domains")}
                      >
                        {d.hostname}
                        <Badge
                          tone={d.status === "active" ? "teal" : "neutral"}
                        >
                          {d.status === "active" ? t("已激活") : t("待配置")}
                        </Badge>
                      </button>
                    ))
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => onNavigate("domains")}
                    >
                      {t("添加自定义域名")}<Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="metadata-pair">
                  <div>
                    <span className="field-label">{t("状态")}</span>
                    <Status r={production} current />
                  </div>
                  <div>
                    <span className="field-label">{t("创建时间")}</span>
                    <span>{date(production.createdAt)}</span>
                  </div>
                </div>
                <div>
                  <span className="field-label">{t("来源")}</span>
                  <span className="with-icon">
                    <GitBranch size={14} />
                    {sourceName[production.source.type] ||
                      production.source.type}
                    {production.source.commit && (
                      <code>{short(production.source.commit, 7)}</code>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <details className="deployment-settings">
              <summary>
                <ChevronRight size={15} />
                {t("部署设置")}</summary>
              <div>
                <span>
                  X Layer · CPU {project.chain.cpuIndex || t("未设置")} / Token{" "}
                  {project.chain.tokenId || t("未设置")}
                </span>
                <button
                  className="text-button"
                  onClick={() => onNavigate("settings")}
                >
                  {t("编辑设置")}<ArrowRight size={14} />
                </button>
              </div>
            </details>
            <div className="panel-footer">
              <span>{t("导入新构建，再选择要发布的版本。")}</span>
              <button
                className="button secondary"
                onClick={() => onNavigate("deployments")}
              >
                <Layers size={14} />
                {t("部署")}</button>
            </div>
          </>
        ) : (
          <Empty
            icon={<Upload />}
            illustration="project"
            title={t("等待你的第一次部署")}
            action={
              <button className="button primary" onClick={onImport}>
                {t("导入构建")}</button>
            }
          >
            {t("选择构建好的网站，或先试用自带示例。")}</Empty>
        )}
      </section>
      <ProjectConnections
        data={data}
        project={project}
        onManage={onManageService}
        onAll={() => onNavigate("storage")}
      />
      <div className="overview-widgets">
        <ProjectJourney
          key={project.id}
          project={project}
          releases={releases}
          current={production}
          onImport={onImport}
          onRelease={onRelease}
          onLearn={onGuide}
        />
        <section className="panel overview-usage">
          <div className="panel-heading">
            <h2>{t("工作台用量")}</h2>
            <button
              className="text-button"
              onClick={() => onNavigate("usage")}
              aria-label={t("查看项目用量")}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <dl>
            <div>
              <dt>{t("归档存储")}</dt>
              <dd>{bytes(releases.reduce((s, r) => s + (r.archive?.state==='purged'?0:r.bytes), 0))}</dd>
            </div>
            <div>
              <dt>{t("部署版本")}</dt>
              <dd>{releases.length}</dd>
            </div>
            <div>
              <dt>{t("预览请求")}</dt>
              <dd>
                {isCloud() ? t("见项目诊断") : data.visits.filter((v) => v.projectId === project.id).length}
              </dd>
            </div>
          </dl>
          <p className="muted small-text">{isCloud() ? t("入口统计见项目「用量与诊断」，供应商账单仍在 Cloudflare 查看。") : t("请求来自工作区最近 2,000 条记录。")}</p>
        </section>
        <section className="panel publish-checklist">
          <div className="panel-heading">
            <h2>{t("公开发布检查")}</h2>
            <Hexagon size={15} />
          </div>
          {[
            {
              label: t("连接发布服务"),
              done: connections.some((c) => c.provider === "cloudflare"),
              click: () => onNavigate("storage"),
              icon: Plug,
            },
            {
              label: t("X Layer 文件核验"),
              done: releases.some((r) => r.chainStatus === "verified"),
              click: () => (production ? onRelease(production) : onImport()),
              icon: Hexagon,
            },
            {
              label: t("添加自定义域名"),
              done: domains.some((d) => d.status === "active"),
              click: () => onNavigate("domains"),
              icon: Globe,
            },
          ].map((s) => (
            <button
              className={"publish-step " + (s.done ? "complete" : "")}
              key={s.label}
              onClick={s.click}
            >
              <s.icon size={15} />
              <span>{s.label}</span>
              {s.done ? <CheckCircle2 size={15} /> : <ChevronRight size={14} />}
            </button>
          ))}
          <button className="text-button" onClick={onGuide}>
            {t("查看完整指南")}<ArrowUpRight size={14} />
          </button>
        </section>
      </div>
      <div className="section-title">
        <h2>{t("最近部署")}</h2>
        <button
          className="text-button"
          onClick={() => onNavigate("deployments")}
        >
          {t("查看全部")}<ArrowRight size={14} />
        </button>
      </div>
      <DeploymentList
        items={releases.slice(0, 5)}
        data={data}
        onOpen={onRelease}
      />
    </>
  );
}
