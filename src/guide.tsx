import { t, useLanguage, uiModel } from "./i18n";
import { useState, useRef, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Compass,
  Database,
  FileArchive,
  Globe,
  Layers,
  LifeBuoy,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import type { Project, Release } from "./types";
import { Modal } from "./ui";
import { preview, isCloud } from "./api";

export type GuideSection = "start" | "features" | "faq";
export type GuideAction =
  | "create"
  | "demo"
  | "import"
  | "deployments"
  | "storage"
  | "domains"
  | "usage"
  | "settings"
  | "chain";
export type GuideTopic =
  | "import"
  | "preview"
  | "versions"
  | "services"
  | "chain"
  | "domains"
  | "settings";

const topics = uiModel([
  {
    id: "import",
    icon: Upload,
    title: "导入构建",
    label: "把作品带进来",
    summary: "把已经构建完成的静态网站交给工作台，为每次修改留下一个独立版本。",
    action: "import",
    cta: "导入一个构建",
    tag: "本地即可使用",
    steps: [
      "在项目中点击「导入构建」，选择 ZIP 或构建目录。",
      "根目录需要 index.html；上传 dist / build 中的产物，而不是整个源码仓库。",
      "给版本起名并导入，核对文件清单，再选择密码私有预览或明确公开分享。",
    ],
    note: "每次导入最多 500 个文件、10 MiB。还没有网站？导入窗口中的「示例 v1 / v2」可以直接体验。",
  },
  {
    id: "preview",
    icon: Globe,
    title: "预览与分享",
    label: "先看看，再发布",
    summary: "云端版本默认仅归档。先用有密码和有效期的独立网址分享，再决定是否公开发布。",
    action: "deployments",
    cta: "查看项目版本",
    tag: "本地预览免费",
    steps: [
      "导入后在部署详情中点击「访问」，检查这个版本。",
      "选择「设为当前版本」，项目概览就会展示它。固定生产地址需再发布 Cloudflare 生产镜像。",
      "云端在部署详情创建私有预览：设置 1 小时至 7 天有效期，复制一次性显示的密码；可换密码或撤销。公开预览需要另行确认。",
    ],
    note: "本地地址只能在这台电脑访问。已经公开过的版本不能重新变成秘密；已授权的人也可以下载副本。公开预览与链上发布分别确认。",
  },
  {
    id: "versions",
    icon: Layers,
    title: "版本与恢复",
    label: "每一步，都有来路",
    summary: "保留旧文件和发布记录。更新不合适时，可以从历史版本重新出发。",
    action: "deployments",
    cta: "打开版本历史",
    tag: "管理版本保留",
    steps: [
      "每次导入新增版本。在「归档与保留」设置保留点和期限；默认 30 天且自动回收关闭。回收站中的版本七天内可恢复。",
      "打开旧版本，点击「恢复此版本」；工作台创建新的恢复版本，并更新工作台当前版本。",
      "如果也要恢复公网或链上内容，需要再执行对应的 Cloudflare 发布或钱包签名发布。",
    ],
    note: "恢复针对网站文件，不回退数据库。导出的 ZIP 包含原始文件和签名回执，可核对文件是否被修改。",
  },
  {
    id: "services",
    icon: Database,
    title: "服务连接",
    label: "用你熟悉的服务",
    summary: "连接自己的账号，把网站交付、应用数据与构建来源放进同一个工作台。",
    action: "storage",
    cta: "管理服务连接",
    tag: "使用自己的账号",
    steps: [
      "在工作空间的「集成」或项目的「服务集成」连接账号，明确选择所属项目。",
      "Cloudflare：在「设置 → 构建与部署」连接预览和生产账号，在部署详情发布公开预览或生产镜像。",
      "Supabase：在「存储与数据」管理两个环境。示例留言板需要先运行配套 SQL，验证访问权限和邮箱验证码。",
      "GitHub：新建项目时选择仓库来源，或进入「设置 → Git」。在「服务集成 → 从源码到新版本」安装构建流程，启动并跟踪 GitHub Actions，完成后导入产物。",
    ],
    note: "Vercel 连接会读取项目与部署配置，静态项目可从同一 Git commit 重建；SSR/API 先适配到 Workers。数据与账单仍属于你的账号。连接检测通过，并不等于应用的数据权限、域名或完整发布流程已经验收。",
  },
  {
    id: "chain",
    icon: Wallet,
    title: "链上发布",
    label: "给版本一份链上记录",
    summary:
      "将网站文件写入你有权使用的 TapeKit 容器，再读回核对。芯片 NFT 的所有权用于检查你是否有发布权限。",
    action: "chain",
    cta: "查看发布准备",
    tag: "需要钱包与链上费用",
    steps: [
      "在项目设置填入处理器编号与芯片 ID；为演示使用独立容器，避免影响已有网站。",
      "打开部署详情，连接钱包并生成发布计划，检查目标、文件和费用。",
      "由钱包逐笔批准交易；文件读回核验完成后，再按所选链的费用和有效期激活入口。激活费属于上游协议，gas 另计。",
    ],
    note: "芯片用于关联发布权限，容器用于存网站文件。不是每次本地预览都要上链；本地测试通过后再决定是否付费发布。",
  },
  {
    id: "domains",
    icon: Cloud,
    title: "域名与访问",
    label: "一个容易记住的地址",
    summary: "让访客通过自己的域名访问 Cloudflare 上的生产镜像。",
    action: "domains",
    cta: "配置项目域名",
    tag: "先完成生产镜像",
    steps: [
      "连接 Cloudflare 生产环境，在部署详情发布生产镜像。",
      "在「域名」中添加完整域名，检查 DNS 变更并明确确认后由工作台配置；也可在域名服务商手动配置。",
      "点击「检查连接」，等待域名验证与 HTTPS 证书生效。",
    ],
    note: "登记域名后需要检查并确认 DNS 变更，工作台才会写入记录。BSC、X Layer 与 Base 文件需要另行发布；Cloudflare 镜像和链上内容各有自己的发布状态。",
  },
  {
    id: "settings",
    icon: ShieldCheck,
    title: "日志、用量与配置",
    label: "知道发生了什么",
    summary: "查看操作记录、归档占用、入口访问统计与链上文件诊断，管理项目的发布目标。",
    action: "settings",
    cta: "查看项目设置",
    tag: "范围清晰，数据真实",
    steps: [
      "「活动日志」记录导入、发布、连接和恢复等工作台操作。",
      "项目「用量与诊断」展示近 30 天 TapeNow 私有与 R2 公开入口的请求、HTTP 错误和文件字节；不含 Pages、链上原生入口、JS 异常或供应商账单。",
      "「项目设置」保存项目说明和链上目标；「环境变量」管理运行时配置。部署 Worker 时可明确确认同步秘密；GitHub 构建变量仍需在自己的 Actions 中配置。",
    ],
    note: "保存环境变量不会自动注入已构建的网页。前端文件可以被访客读取，不应包含管理密钥或数据库密码。",
  },
] as const);

const questions = uiModel([
  [
    "没有钱包，也能先体验吗？",
    "可以。创建项目、导入示例、预览、更新、恢复和导出归档都不需要钱包。只有你决定向 BSC、X Layer 或 Base 发布时才需要连接钱包并确认交易。",
  ],
  [
    "哪些操作会花钱？",
    "本地体验不产生链上费用。链上 gas 付给区块链；芯片、容器及入口激活按上游协议计费，不是 TapeNow 平台费。截至 2026-09-28，BSC 激活服务费为 0，X Layer 为 0.026 OKB／30 天，Base 为 0.0012 ETH／30 天，均另计 gas。云服务和域名按供应商套餐计费。付款前查看最新计划，详见下方「费用说明」。",
  ],
  [
    "应该上传源码，还是打包后的文件？",
    "上传构建后的静态文件，例如 dist 目录或它的 ZIP。根目录包含 index.html，最多 500 个文件、10 MiB。这里不运行 npm build，也不提供在线编辑器；GitHub 方式会先在 Actions 中构建。",
  ],
  [
    "为什么把预览链接发给朋友打不开？",
    "本地地址只指向各自的电脑。云端请在部署详情创建私有预览，把链接和密码发给朋友；检查有效期及撤销状态。也可以明确确认生成公开预览。本地模式可连接 Cloudflare 再发布公开预览。",
  ],
  [
    "恢复版本后，用户的留言也会变回去吗？",
    "不会因为恢复网站文件而回退数据库。无账号示例的留言保存在当前浏览器里，使用项目的稳定预览地址可以跨更新保留。接入 Supabase 后，数据库内容独立保存，仍需考虑新旧网页与数据结构的兼容。",
  ],
  [
    "芯片、容器和域名分别是什么？",
    "可以把芯片理解为关联发布权限的凭证，容器是保存网站文件的地方，域名是访客输入的地址。拥有芯片并不表示网站已经上传；上传完成也不等于域名已配置。工作台分别展示这些状态。",
  ],
  [
    "我连接 Supabase 后，所有网站都会自动有数据库吗？",
    "不会。网站本身需要使用 Supabase 的接口。配套示例提供邮箱验证码登录和留言板，需要配置自己的项目、运行示例 SQL 并验证权限，再导入包含该配置的新示例版本。旧归档不会被自动改写。",
  ],
  [
    "网页关掉、电脑重启后，项目还在吗？",
    "云端账户的项目保存在 Supabase，网站文件保存在 R2，关闭网页后仍在。本地模式的数据只在本机，需要启动本地服务。两个模式的数据不会自动互相迁移。建议定期导出重要版本。",
  ],
  [
    "现在可以直接拿它做正式线上服务吗？",
    "云端首版采用邀请测试，可用自己的服务连接完成构建和部署；尚无生产 SLA、自动灾备和完整应用监控。重要生产网站请先验收兼容性、权限与恢复流程，并保留独立备份。",
  ],
]);

export function GuideCenter({
  initialSection = "start",
  initialTopic = "import",
  projects,
  currentProject,
  onClose,
  onAction,
}: {
  initialSection?: GuideSection;
  initialTopic?: GuideTopic;
  projects: Project[];
  currentProject?: Project;
  onClose: () => void;
  onAction: (action: GuideAction, projectId?: string) => void;
}) {
 useLanguage();
  const [section, setSection] = useState<GuideSection>(initialSection);
  const [topic, setTopic] = useState<GuideTopic>(initialTopic);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState(currentProject?.id || "");
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabs: { id: GuideSection; label: string; icon: typeof Play }[] = [
    { id: "start", label: t("快速上手"), icon: Compass },
    { id: "features", label: t("功能地图"), icon: Layers },
    { id: "faq", label: t("常见问题"), icon: LifeBuoy },
  ];
  const term = query.trim().toLowerCase();
  const visible = topics.filter((t) =>
    [t.title, t.summary, t.note, ...t.steps]
      .join(" ")
      .toLowerCase()
      .includes(term),
  );
  const active = visible.find((t) => t.id === topic) || visible[0];
  const faq = questions.filter((q) => q.join(" ").toLowerCase().includes(term));
  function switchTab(next: GuideSection) {
    setSection(next);
    setQuery("");
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    switchTab(tabs[next].id);
    tabsRef.current
      ?.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
      [next]?.focus();
  }
  const targetPicker = (
    <label className="guide-project-picker">
      <span>{t("操作的项目")}</span>
      <select
        aria-label={t("引导目标项目")}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <option value="">{t("选择一个项目")}</option>
        {projects.map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Modal
      title={t("你的发布指南")}
      kicker="A GOOD PLACE TO START"
      wide
      className="guide-modal"
      onClose={onClose}
    >
      <div
        className="guide-tabs"
        role="tablist"
        aria-label={t("使用指南分类")}
        ref={tabsRef}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={"guide-tab-" + tab.id}
            role="tab"
            aria-selected={section === tab.id}
            aria-controls={"guide-panel-" + tab.id}
            tabIndex={section === tab.id ? 0 : -1}
            onKeyDown={(e) => tabKey(e, i)}
            onClick={() => switchTab(tab.id)}
          >
            <tab.icon size={17} />
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="guide-body"
        role="tabpanel"
        id={"guide-panel-" + section}
        aria-labelledby={"guide-tab-" + section}
      >
        {section === "start" ? (
          <>
            <div className="guide-welcome">
              <div>
                <span className="eyebrow">YOUR FIRST DEPLOYMENT</span>
                <h3>
                  {t("先让一个小网站，")}<br />
                  {t("在这里跑起来。")}</h3>
                <p>
                  {t("大约 3 分钟，体验导入、预览与版本管理。")}<br />
                  {t("不需要钱包，也不需要购买云服务。")}</p>
              </div>
              <span className="guide-welcome-art" aria-hidden="true">
                <FileArchive size={42} />
                <i />
                <Sparkles size={24} />
              </span>
            </div>
            <ol className="guide-walkthrough">
              {[
                [
                  t("建一个项目"),
                  t("给网站起个名字，所有版本都会归档在这里。"),
                  Layers,
                ],
                [
                  t("带入第一个版本"),
                  t("选示例 v1，或上传自己的 ZIP / 构建目录。"),
                  Upload,
                ],
                [
                  t("设为当前版本"),
                  t("在部署详情中确认，概览就会展示这个版本。"),
                  Check,
                ],
                [t("打开预览"), t("云端先创建密码预览，再点「打开预览」。试着导入 v2 并恢复旧版。"), Globe],
              ].map(([title, description, Icon], i) => {
                const StepIcon = Icon as typeof Layers;
                return (
                  <li key={String(title)}>
                    <span className="walkthrough-number">0{i + 1}</span>
                    <StepIcon size={19} />
                    <div>
                      <h4>{String(title)}</h4>
                      <p>{String(description)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="guide-start-action">
              <div>
                <strong>{t("从一个全新的体验项目开始")}</strong>
                <p>{t("填写名称后自动生成示例 v1；已有项目不会被修改。")}</p>
              </div>
              <button
                className="button primary"
                onClick={() => onAction("demo")}
              >
                <Play size={15} />
                {t("创建体验项目")}</button>
            </div>
            <div className="guide-existing">
              <span>{t("已经有项目？接着往下做。")}</span>
              {targetPicker}
              <button
                className="text-button"
                disabled={!projectId}
                onClick={() => onAction("import", projectId)}
              >
                {t("去导入构建")}<ArrowRight size={15} />
              </button>
            </div>
            <button
              className="guide-next-reading"
              onClick={() => switchTab("features")}
            >
              <BookOpen size={18} />
              <span>{t("本地体验之后，如何公开分享和上链？")}</span>
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <>
            <div className="guide-search">
              <Search size={18} />
              <input
                aria-label={t("搜索指南")}
                placeholder={
                  section === "faq"
                    ? t("搜索问题，例如：钱包、费用、恢复…")
                    : t("查找功能，例如：预览、域名、Supabase…")
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label={t("清除指南搜索")}
                  onClick={() => setQuery("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {section === "features" ? (
              <>
                {active ? (
                  <div className="feature-browser">
                    <nav aria-label={t("功能主题")}>
                      {visible.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTopic(t.id)}
                          aria-current={t.id === active.id ? "true" : undefined}
                        >
                          <t.icon size={18} />
                          <span>{t.title}</span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </nav>
                    <article className="feature-article">
                      <span className="feature-tag">{active.tag}</span>
                      <span className="feature-article-icon">
                        <active.icon size={27} />
                      </span>
                      <h3>{active.label}</h3>
                      <p className="feature-summary">{active.summary}</p>
                      <ol>
                        {active.steps.map((step, i) => (
                          <li key={step}>
                            <span>{i + 1}</span>
                            <p>{step}</p>
                          </li>
                        ))}
                      </ol>
                      <div className="feature-note">
                        <ShieldCheck size={18} />
                        <p>{active.note}</p>
                      </div>
                      {targetPicker}
                      <button
                        className="button primary"
                        disabled={!projectId}
                        onClick={() =>
                          onAction(active.action as GuideAction, projectId)
                        }
                      >
                        {active.cta}
                        <ArrowUpRight size={16} />
                      </button>
                      {!projectId && (
                        <small className="guide-select-hint">
                          {t("先选择操作的项目，或")}<button onClick={() => onAction("create")}>
                            {t("创建一个项目")}</button>
                          。
                        </small>
                      )}
                    </article>
                  </div>
                ) : (
                  <div className="guide-no-results">
                    <Search size={26} />
                    <h3>{t("还没有找到相关功能")}</h3>
                    <p>{t("试试“导入”“分享”或“链上”。")}</p>
                    <button
                      className="text-button"
                      onClick={() => setQuery("")}
                    >
                      {t("查看全部功能")}</button>
                  </div>
                )}
              </>
            ) : (
              <div className="faq-list">
                {faq.length ? (
                  faq.map(([q, a]) => (
                    <details key={q}>
                      <summary>
                        {q}
                        <ChevronDown size={18} />
                      </summary>
                      <p>{a}</p>
                    </details>
                  ))
                ) : (
                  <div className="guide-no-results">
                    <LifeBuoy size={26} />
                    <h3>{t("没有找到这个问题")}</h3>
                    <button
                      className="text-button"
                      onClick={() => setQuery("")}
                    >
                      {t("查看全部问题")}</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="guide-footer">
        <span>
          <SunMark />
          {t("先验收预览，再决定如何发布。")}</span>
        <a href="/docs/manual/" target="_blank" rel="noopener noreferrer" className="text-button">{t("用户手册")}<ArrowUpRight size={14} /></a>
        <a href="/docs/fees.html" target="_blank" rel="noreferrer" className="text-button">{t("费用说明")}<ArrowUpRight size={14} /></a>
      </div>
    </Modal>
  );
}

function SunMark() {
 useLanguage();
  return <Sparkles size={15} aria-hidden="true" />;
}

function readPreference(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Browsers may disable local preference storage. */
  }
}

export function ProjectJourney({
  project,
  releases,
  current,
  onImport,
  onRelease,
  onLearn,
}: {
  project: Project;
  releases: Release[];
  current?: Release;
  onImport: () => void;
  onRelease: (r: Release) => void;
  onLearn: () => void;
}) {
 useLanguage();
  const [collapsed, setCollapsed] = useState(
    () => readPreference("deweb-guide-hidden-" + project.id) === "yes",
  );
  const [opened, setOpened] = useState(() =>
    readPreference("deweb-guide-preview-" + project.id),
  );
  const target=current||releases.find(r=>!r.archive?.state||r.archive.state==='available');
  const ready=!!target&&(!isCloud()||!!target.preview?.url||!!target.site?.url||(target.privatePreview?.status==='active'&&Date.parse(target.privatePreview.expiresAt)>Date.now()));
  const done = [releases.length > 0, ready, ready && opened === target?.id];
  const completed = done.filter(Boolean).length;
  if (collapsed)
    return (
      <button
        className="journey-reopen"
        onClick={() => {
          setCollapsed(false);
          writePreference("deweb-guide-hidden-" + project.id, "no");
        }}
      >
        <Compass size={15} />
        {t("显示操作引导")}<ChevronDown size={14} />
      </button>
    );
  return (
    <section className="project-journey" aria-label={t("项目上手引导")}>
      <div className="journey-heading">
        <span className="journey-emblem">
          <Compass size={21} />
        </span>
        <div>
          <strong>
            {completed === 3
              ? t("预览体验已完成，准备下一次发布")
              : t("跟着这三步，打开你的网站")}
          </strong>
          <span>{completed} {t("/ 3 步 · 随时可以收起")}</span>
        </div>
        <button className="text-button" onClick={onLearn}>
          {t("查看指南")}<ArrowUpRight size={14} />
        </button>
        <button
          className="icon-button"
          aria-label={t("收起操作引导")}
          onClick={() => {
            setCollapsed(true);
            writePreference("deweb-guide-hidden-" + project.id, "yes");
          }}
        >
          <X size={17} />
        </button>
      </div>
      <ol>
        <li className={done[0] ? "complete" : "next"}>
          <span>{done[0] ? <Check size={15} /> : "1"}</span>
          <div>
            <strong>{t("导入网站")}</strong>
            <small>{t("示例或自己的构建包")}</small>
          </div>
          <button onClick={onImport}>
            {done[0] ? t("再导入") : t("去导入")}
            <ArrowRight size={14} />
          </button>
        </li>
        <li className={done[1] ? "complete" : done[0] ? "next" : ""}>
          <span>{done[1] ? <Check size={15} /> : "2"}</span>
          <div>
            <strong>{t("创建预览")}</strong>
            <small>{t("在部署详情选择访问方式")}</small>
          </div>
          <button
            disabled={!target}
            onClick={() => target && onRelease(target)}
          >
            {done[1] ? t("查看") : t("去设置")}
            <ArrowRight size={14} />
          </button>
        </li>
        <li className={done[2] ? "complete" : done[1] ? "next" : ""}>
          <span>{done[2] ? <Check size={15} /> : "3"}</span>
          <div>
            <strong>{t("打开预览")}</strong>
            <small>{done[2] ? t("预览入口已打开") : isCloud() ? t("先创建私有或公开预览") : t("仅这台电脑可访问")}</small>
          </div>
          {target && ready ? (
            <a
              href={preview(project.id,target.id)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setOpened(target.id);
                writePreference(
                  "deweb-guide-preview-" + project.id,
                  target.id,
                );
              }}
            >
              {t("打开")}<ArrowUpRight size={14} />
            </a>
          ) : (
            <button disabled>
              {t("打开")}<ArrowUpRight size={14} />
            </button>
          )}
        </li>
      </ol>
    </section>
  );
}

const context: Record<
  string,
  { title: string; text: string; topic: GuideTopic }
> = uiModel({
  deployments: {
    title: "独立预览、当前版本、正式发布，有什么区别？",
    text: "每次导入先保存独立归档；选择创建私有或公开预览后才有可分享网址。正式发布并核验后再切换访问入口。Cloudflare 镜像与 BSC、X Layer 或 Base 内容分别发布，状态互不代替。",
    topic: "preview",
  },
  storage: {
    title: "先连接哪个服务？",
    text: "云端导入默认不公开，密码私有预览可直接创建。自定义域名和运行时需连接自己的 Cloudflare；网站需要登录和数据，再接 Supabase；源码构建接 GitHub，迁移现有站点可再接 Vercel。",
    topic: "services",
  },
  data: {
    title: "连上数据库，就能直接使用了吗？",
    text: "网站需要调用自己的 Supabase 接口。分别绑定预览和生产数据库，检查是否隔离；可向当前登录邮箱发送并验证测试验证码。连接检测和收信验证不代替业务表、RLS 与应用登录验收。",
    topic: "services",
  },
  domains: {
    title: "绑定域名前，需要准备什么？",
    text: "Cloudflare Pages 域名需要先发布生产镜像；HashPort 域名需要先完成 BSC 文件发布。登记域名后检查并确认 DNS 变更，再核验 HTTPS 与文件；登记成功不等于访问已生效。",
    topic: "domains",
  },
  logs: {
    title: "这里记录哪些信息？",
    text: "这里记录工作台的导入、连接、发布和恢复操作。应用代码的运行错误、用户行为分析和外部服务日志需要额外接入。",
    topic: "settings",
  },
  usage: {
    title: "这些数字会影响账单吗？",
    text: "这里显示归档的原始文件大小。项目诊断另有近 30 天 TapeNow 私有与 R2 公开入口统计，不包括 Pages、原生链上入口和浏览器 JS 错误。供应商费用仍以自己的账号和钱包为准。",
    topic: "settings",
  },
  environment: {
    title: "变量会自动注入网站吗？",
    text: "部署 Worker 时会使用所选环境的变量，同步秘密需要单独确认。GitHub 构建变量仍需在自己的 Actions 中设置，秘密不能打包进静态文件。",
    topic: "settings",
  },
  settings: {
    title: "芯片发布目标在哪里设置？",
    text: "在项目设置的「链上发布目标」中选择 BSC、X Layer 或 Base，再填写处理器与芯片编号。环境变量有单独入口，可用于 Worker 部署；不会改写静态网站的构建文件。",
    topic: "settings",
  },
});

export function ContextGuide({
  view,
  onLearn,
}: {
  view: string;
  onLearn: (topic: GuideTopic) => void;
}) {
 useLanguage();
  const item = context[view];
  if (!item) return null;
  return (
    <details className="context-guide">
      <summary>
        <BookOpen size={17} />
        <span>{item.title}</span>
        <ChevronDown size={17} />
      </summary>
      <div>
        <p>{item.text}</p>
        <button className="text-button" onClick={() => onLearn(item.topic)}>
          {t("查看完整说明")}<ArrowRight size={15} />
        </button>
      </div>
    </details>
  );
}
