import {WebMCPBridge} from './webmcp';
import './webmcp.css';
import {BetaNotice,MobileChainNotice,NativeAccessPanel,OperationsPanel} from './beta';
import {GatewayPanel} from "./gateway";
import {network} from "./chains";
import { t, useLanguage, uiModel, LanguageProvider, LanguageSwitcher, translateMessage } from "./i18n";
import {WorkspaceSwitch,TeamPanel,PostgresPanel,DependencyPanel,EcosystemPage,DomainControls,CostSources} from "./p0";
import {InvitationPage,FirstUse,PrivatePreviewPanel,ArchivesPage,DiagnosticsPage} from "./batch2";
import {ReleaseControls,RestoreDialog} from "./release-controls";
import {RuntimePanel} from "./runtime-panel";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Users,
  LayoutGrid,
  Layers,
  Activity,
  Database,
  Globe,
  Settings,
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  GitBranch,
  ArrowUpRight,
  ArrowLeft,
  Upload,
  Check,
  CheckCircle2,
  FileCode2,
  Folder,
  Download,
  RotateCcw,
  Cloud,
  Plug,
  ShieldCheck,
  Wallet,
  Menu,
  X,
  HardDrive,
  BarChart3,
  Copy,
  Trash2,
  RefreshCw,
  KeyRound,
  ArrowRight,
  Loader2,
  Hexagon,
  BookOpen,
  PackageCheck,
  AlertTriangle,
  MessageSquareText,
} from "lucide-react";
import { api, cloudflareOperation, publishVersionedSite, initialize, bytes, date, short, preview, file64, getSession, isCloud, hasVersionedSites, canHost } from "./api";
import type { State, Project, Release, Plan } from "./types";
import {
  Badge,
  Brand,
  Modal,
  Empty,
  External,
  Notice,
  ReleaseStatus as Status,
  WebsitePreview,
} from "./ui";
import {
  WorkspaceHome,
  ProjectOverview,
  DeploymentList,
  sourceName,
} from "./workspace";
import {
  GuideCenter,
  ContextGuide,
  type GuideAction,
  type GuideSection,
  type GuideTopic,
} from "./guide";
import "./styles.css";
import "./guides.css";
import "./coast.css";
import {
  IntegrationsPage,
  StoragePage,
  GitSettings,
  DeliverySettings,
  providers,
  type Provider,
} from "./integrations";
import "./integrations.css";
import { OAuthConnect } from "./oauth";
import {SessionBoundary, AccountMenu} from "./auth";
import {FeedbackButton} from "./feedback";
import {FeedbackAdminPage} from "./feedback-admin";
import {SourcePanel} from "./source-panel";
import "./brand.css";

type View =
  | "team"
  | "ecosystem"
  | "invitations"
  | "feedback"
  | "archives"
  | "overview"
  | "deployments"
  | "logs"
  | "storage"
  | "data"
  | "domains"
  | "usage"
  | "settings"
  | "environment";
const navigation: { id: View; label: string; icon: typeof Layers }[] = uiModel([
  { id: "overview", label: "项目概览", icon: LayoutGrid },
  { id: "deployments", label: "部署", icon: Layers },
  { id: "logs", label: "活动日志", icon: Activity },
  { id: "environment", label: "环境变量", icon: KeyRound },
  { id: "domains", label: "域名", icon: Globe },
  { id: "storage", label: "服务集成", icon: Plug },
  { id: "data", label: "存储与数据", icon: Database },
  { id: "archives", label: "归档与保留", icon: HardDrive },
  { id: "invitations", label: "邀请用户", icon: Users },
  { id: "feedback", label: "用户反馈", icon: MessageSquareText },
  { id: "usage", label: "用量与诊断", icon: BarChart3 },
  { id: "team", label: "项目成员", icon: Users },
  { id: "ecosystem", label: "生态与链上站点", icon: Globe },
  { id: "settings", label: "项目设置", icon: Settings },
]);
const names: Record<string, string> = uiModel({
  cloudflare: "Cloudflare",
  supabase: "Supabase",
  github: "GitHub",
  vercel: "Vercel",
});
const emptyState: State = {
  projects: [],
  releases: [],
  connections: {},
  logs: [],
  domains: [],
  visits: [],
};
// Reason codes come from the OAuth callback; each names what the user can do next.
function oauthFailure(reason: string) {
  switch (reason) {
    case "session":
      return t("授权页面回到 TapeNow 时没有登录状态。请在原来的 TapeNow 页面重新连接；Safari 无痕浏览或拦截弹出窗口时常见，请改用普通窗口。");
    case "state":
    case "expired":
      return t("这次授权已过期或已使用。请回到 TapeNow 重新点击连接，并在 10 分钟内完成。");
    case "browser":
      return t("授权必须在发起连接的同一个浏览器窗口中完成。请在当前窗口重新连接。");
    case "provider":
      return t("供应商没有接受这次授权，请重新连接。");
    default:
      return t("授权未完成，请重新发起并在同一浏览器中完成连接");
  }
}
function readRoute() {
  const p = location.hash.slice(1).split("/").filter(Boolean);
  return {
    projectId: p[0] === "~" ? "" : p[0] || "",
    releaseId: p[1] === "deployments" ? p[2] || "" : "",
    section:
      p[1] === "settings" && ["git", "delivery", "chain"].includes(p[2])
        ? p[2]
        : "general",
    view: (navigation.some((n) => n.id === p[1]) ? p[1] : "overview") as View,
  };
}
function App() {
 useLanguage();
  const [data, setData] = useState<State>(emptyState),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [route, setRoute] = useState(readRoute),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [mobile, setMobile] = useState(false),
    [wallet, setWallet] = useState("");
  const [modal, setModal] = useState<
      | null
      | "project"
      | "import"
      | "connect"
      | "domain"
      | "env"
      | "help"
      | "find"
    >(null),
    [provider, setProvider] = useState<Provider>("cloudflare"),
    [confirm, setConfirm] = useState<{
      type: "promote" | "restore";
      r: Release;
    } | null>(null),
    [filter, setFilter] = useState("all"),
    [planState, setPlanState] = useState<{
      releaseId: string;
      value: Plan | null;
    } | null>(null);
  const [guide, setGuide] = useState<{
    section: GuideSection;
    topic: GuideTopic;
  }>({ section: "start", topic: "import" });
  const [guidedCreate, setGuidedCreate] = useState(false);
  const [projectSource, setProjectSource] = useState("upload");
  const [manualConnection, setManualConnection] = useState(false);
  const [initialGrant, setInitialGrant] = useState("");
  const [connectProjectId, setConnectProjectId] = useState("");
  const [connectEnvironment, setConnectEnvironment] = useState("preview");
  const settingsSection = route.section;
  const [commandQuery, setCommandQuery] = useState("");
  const detailId = route.releaseId;
  const plan = planState?.releaseId === detailId ? planState.value : null;
  function setPlan(value: Plan | null) {
    setPlanState({ releaseId: detailId, value });
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const project = data.projects.find((p) => p.id === route.projectId);
  const releases = data.releases.filter(
    (r) => !project || r.projectId === project.id,
  );
  const production = project
    ? releases.find((r) => r.id === project.productionId)
    : undefined;
  const detail = data.releases.find(
    (r) => r.id === detailId && r.projectId === route.projectId,
  );
  const refresh = useCallback(async () => {
    setData(await api<State>("/state"));
  }, []);
  const boot = useCallback(async () => {
    try {
      await initialize();
      await refresh();
      setLoaded(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refresh]);
  useEffect(() => {
    void boot();
    const handler = () => {
      setRoute(readRoute());
      setSearch("");
      setFilter("all");
      setMobile(false);
    };
    window.addEventListener("hashchange", handler);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    }, 10000);
    return () => {
      window.removeEventListener("hashchange", handler);
      clearInterval(timer);
    };
  }, [boot, refresh]);
  useEffect(() => {
    if (!loaded) return;
    const q = new URLSearchParams(window.location.search);
    if (!q.has("oauth")) return;
    const result = q.get("oauth"),
      service = q.get("provider");
    const known = service === "cloudflare" || service === "supabase" || service === "github" || service === "vercel";
    if (
      (result === "connected" || (result === "installed" && service === "github")) &&
      known
    ) {
      setProvider(service);
      setManualConnection(false);
      setInitialGrant(q.get("grant") || "");
      setConnectProjectId(q.get("project") || "");
      setConnectEnvironment(
        q.get("environment") === "production" ? "production" : "preview",
      );
      setModal("connect");
    } else
      setToast({
        text:
          result === "cancelled"
            ? t("已取消授权，项目连接未更改")
            : oauthFailure(q.get("reason") || ""),
        error: result !== "cancelled",
      });
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.hash,
    );
  }, [loaded]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.projectId, route.view, route.releaseId, route.section]);
  useEffect(() => {
    if (!mobile) return;
    const prior = document.activeElement as HTMLElement | null;
    const sidebar = document.getElementById("project-navigation");
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobile(false);
      }
      if (e.key === "Tab") {
        const items = Array.from(
          sidebar?.querySelectorAll<HTMLElement>("button,select,a[href]") || [],
        ).filter(
          (el) =>
            el.getClientRects().length > 0 &&
            !(el instanceof HTMLButtonElement && el.disabled),
        );
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, [mobile]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        setCommandQuery("");
        setModal("find");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setPlanState(null);
    if (detailId)
      void api<Plan | null>("/releases/" + detailId + "/chain/plan")
        .then((p) => {
          if (p) {
            const saved = localStorage.getItem("deweb-pending-" + detailId);
            if (saved && !p.pending) {
              try {
                const pending = JSON.parse(saved);
                if (pending.index === p.completed.length) p.pending = pending;
              } catch {}
            }
          }
          if (!cancelled) setPlanState({ releaseId: detailId, value: p });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detailId]);
  function navigate(
    view: View = "overview",
    pid = route.projectId,
    releaseId = "",
    section = "general",
  ) {
    location.hash = pid
      ? "/" +
        pid +
        "/" +
        view +
        (releaseId
          ? "/" + releaseId
          : view === "settings" && section !== "general"
            ? "/" + section
            : "")
      : view === "overview"
        ? "/"
        : "/~/" + view;
    setRoute({ projectId: pid, view, releaseId, section });
    setSearch("");
    setFilter("all");
    setMobile(false);
  }
  async function run<T>(
    label: string,
    fn: () => Promise<T>,
    success?: string,
  ): Promise<T | undefined> {
    if(project?.role==="viewer"){setToast({text:t("只读成员不能执行修改操作"),error:true});return undefined;}
    setBusy(label);
    try {
      const result = await fn();
      await refresh();
      if (success) setToast({ text: success });
      return result;
    } catch (e) {
      // Provider writes can succeed before readback fails; surface saved progress.
      await refresh().catch(() => {});
      setToast({ text: (e as Error).message, error: true });
      return undefined;
    } finally {
      setBusy("");
    }
  }
  function form(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
  }
  const closeModal = useCallback(() => setModal(null), []),
    closeConfirm = useCallback(() => setConfirm(null), []);
  function connect(
    name: Provider,
    pid = route.projectId,
    environment = "preview",
  ) {
    setProvider(name);
    setManualConnection(false);
    setInitialGrant("");
    setConnectProjectId(
      pid || (data.projects.length === 1 ? data.projects[0].id : ""),
    );
    setConnectEnvironment(["github", "vercel"].includes(name) ? "preview" : environment);
    setModal("connect");
  }
  function manageService(name: Provider | "chain", pid: string) {
    if (name === "supabase") navigate("data", pid);
    else
      navigate(
        "settings",
        pid,
        "",
        name === "github" ? "git" : name === "chain" ? "chain" : "delivery",
      );
  }
  function importGitHub(pid: string) {
    void run(
      t("导入 GitHub 构建"),
      async () => {
        const r = await api<Release>(
          "/projects/" + pid + "/github-artifact",
          {},
        );
        openRelease(r);
      },
      t("GitHub 构建已导入"),
    );
  }
  function disconnect(key: string) {
    void run(
      t("移除连接"),
      () => api("/connections/" + encodeURIComponent(key), {}, "DELETE"),
      t("本地凭证已移除，供应商资源保留"),
    );
  }
  function openRelease(r: Release) {
    navigate("deployments", r.projectId, r.id);
  }
  const openGuide = useCallback(
    (section: GuideSection = "start", topic: GuideTopic = "import") => {
      setGuide({ section, topic });
      setMobile(false);
      setModal("help");
    },
    [],
  );
  function guideAction(action: GuideAction, pid?: string) {
    if (action === "create" || action === "demo") {
      setGuidedCreate(action === "demo");
      setProjectSource(action === "demo" ? "sample" : "upload");
      setModal("project");
      return;
    }
    const target = data.projects.find((p) => p.id === pid);
    if (!target) {
      setToast({ text: t("请先选择一个项目"), error: true });
      return;
    }
    setModal(null);
    const view =
      action === "import" || action === "chain" ? "overview" : action;
    navigate(view, target.id);
    if (action === "import") setModal("import");
    if (action === "chain") {
      const release =
        data.releases.find((r) => r.id === target.productionId) ||
        data.releases.find((r) => r.projectId === target.id);
      if (release) openRelease(release);
      else setModal("import");
    }
  }
  async function connectWallet() {
    const w = window.okxwallet || window.ethereum;
    if (!w) throw Error(t("请在此浏览器安装或启用兼容 EVM 的钱包"));
    const accounts = await w.request({ method: "eth_requestAccounts" });
    if (!accounts[0]) throw Error(t("没有获得钱包地址"));
    setWallet(accounts[0]);
    return accounts[0] as string;
  }
  async function prepare(r: Release) {
    const address = wallet || (await connectWallet());
    const p = await api<Plan>("/releases/" + r.id + "/chain/prepare", {
      from: address,
    });
    setPlan(p);
  }
  async function signStep(r: Release) {
    if (!plan) return;
    const w = window.okxwallet || window.ethereum;
    if (!w) throw Error(t("请启用浏览器钱包"));
    const index = plan.completed.length;
    if (index >= plan.steps.length) return;
    let hash = plan.pending?.index === index ? plan.pending.hash : "";
    if (!hash) {
      if (plan.signing)
        throw Error(
          t("上一笔签署结果未知，请在钱包核对后填写交易哈希，避免重复发送"),
        );
      const accounts = await w.request({ method: "eth_requestAccounts" });
      if (accounts[0]?.toLowerCase() !== plan.from.toLowerCase())
        throw Error(t("请切回生成计划时的钱包地址"));
      try {
        await w.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x"+plan.chainId.toString(16) }],
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await w.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x"+plan.chainId.toString(16),
              chainName: network(plan.chainId).name,
              nativeCurrency: { name: network(plan.chainId).symbol, symbol: network(plan.chainId).symbol, decimals: 18 },
              rpcUrls: [network(plan.chainId).rpc],
              blockExplorerUrls: [network(plan.chainId).explorer],
            },
          ],
        });
      }
      if(Number(await w.request({method:"eth_chainId"}))!==plan.chainId)throw Error(t("钱包网络尚未切换成功"));
      const quote=await api<{id:string}>("/releases/" + r.id + "/chain/preflight", {});
      const intent=await api<{transaction:Record<string,string>}>("/releases/" + r.id + "/chain/intent", { index,quoteId:quote.id });
      setPlan({
        ...plan,
        signing: { index, startedAt: new Date().toISOString() },
      });
      try {
        hash = await w.request({method:"eth_sendTransaction",params:[intent.transaction]});
      } catch (e) {
        if ((e as { code?: number }).code === 4001) {
          await api("/releases/" + r.id + "/chain/rejected", {});
          setPlan({ ...plan, signing: undefined });
        }
        throw e;
      }
      const pending = { index, hash };
      localStorage.setItem("deweb-pending-" + r.id, JSON.stringify(pending));
      setPlan({ ...plan, pending });
    }
    await api("/releases/" + r.id + "/chain/pending", { index, hash });
    try {
      await api("/releases/" + r.id + "/chain/confirm", { index, hash });
    } finally {
      const latest = await api<Plan>("/releases/" + r.id + "/chain/plan");
      if (!latest.pending && !latest.signing)
        localStorage.removeItem("deweb-pending-" + r.id);
      setPlan(latest);
    }
  }

  const selectedReleases = releases.filter(
    (r) =>
      (r.label + " " + r.id + " " + r.source.type)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "chain"
          ? r.chainStatus === "verified"
          : r.id ===
            data.projects.find((p) => p.id === r.projectId)?.productionId)),
  );
  const logItems = data.logs.filter(
    (l) =>
      (!project || l.projectId === project.id) &&
      l.message.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || l.level === filter),
  );
  const searchPlaceholder =
    route.view === "logs"
      ? t("搜索活动日志…")
      : route.view === "deployments"
        ? t("搜索部署…")
        : t("搜索项目…");
  const deploymentPage = detail ? (
    <div className="deployment-detail">
      <nav className="detail-tabs" aria-label={t("部署详情导航")}>
        {[
          ["deployment-summary", t("部署详情")],
          ["release-approval", t("发布检查")],
          ["build-files", t("构建文件")],
          ["cloud-publish", "Cloudflare"],
          ["chain-publish", t("链上发布")],
          ["gateway-publish", "Gateway"],
          ["release-receipts", t("版本与回执")],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => {
              const el = document.getElementById(id);
              if (el instanceof HTMLDetailsElement) el.open = true;
              el?.scrollIntoView({ block: "start" });
              el?.focus({ preventScroll: true });
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <section
        className="panel detail-summary"
        id="deployment-summary"
        tabIndex={-1}
      >
        <div className="panel-heading">
          <h1>{t("部署详情")}</h1>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => navigate("logs", detail.projectId)}
            >
              <Activity size={14} />
              {t("日志")}</button>
            {(!isCloud()||detail.preview?.url||detail.site?.url||detail.gateway?.status==="active"||detail.privatePreview?.status==="active")&&<External href={preview(detail.projectId, detail.id)}>{t("访问")}</External>}
          </div>
        </div>
        <div className="production-body">
          <WebsitePreview
            href={preview(detail.projectId, detail.id)}
            locked={isCloud()&&detail.privatePreview?.status==="active"}
            unpublished={isCloud()&&!detail.preview?.url&&!detail.site?.url&&detail.gateway?.status!=="active"&&detail.privatePreview?.status!=="active"}
            title={t("此部署网站缩略图")}
            label={t("打开此部署预览")}
          />
          <div className="production-metadata">
            <div className="detail-metrics">
              <div>
                <span>{t("创建时间")}</span>
                <strong>{date(detail.createdAt)}</strong>
              </div>
              <div>
                <span>{t("状态")}</span>
                <Status
                  r={detail}
                  current={project?.productionId === detail.id}
                />
              </div>
              <div>
                <span>{t("文件 / 大小")}</span>
                <strong>
                  {detail.files.length} {t("个 ·")}{bytes(detail.bytes)}
                </strong>
              </div>
            </div>
            <div>
              <span className="field-label">{t("部署")}</span>
              <strong>{detail.label}</strong>
              <code>{detail.id}</code>
            </div>
            <div>
              <span className="field-label">{t("来源")}</span>
              <span className="with-icon">
                <GitBranch size={14} />
                {sourceName[detail.source.type] || detail.source.type}
                {detail.source.commit && (
                  <code>{short(detail.source.commit, 7)}</code>
                )}
              </span>
            </div>
            <div>
              <span className="field-label">{t("预览环境")}</span>
              <span>
                {project?.productionId === detail.id
                  ? (isCloud() ? t("当前版本") : t("本地当前版本"))
                  : t("独立预览")}{" "}
                · {isCloud() ? detail.privatePreview?.status==="active"?t("密码预览"):detail.gateway?.status==="active"?"Gateway":detail.preview?.url?t("公开预览链接"):t("仅归档") : t("仅这台电脑可访问")}
              </span>
            </div>
          </div>
        </div>
      </section>
      <BetaNotice/>
      {isCloud()&&<OperationsPanel/>}
      <NativeAccessPanel key={"native-"+detail.id} release={detail} readOnly={project?.role==='viewer'} onChange={refresh}/>
      <PrivatePreviewPanel key={"private-"+detail.id} release={detail} onChanged={refresh}/>
      {project && <ReleaseControls key={"release-"+detail.id} release={detail} project={project} onChange={refresh}/>}
      {project && <GatewayPanel key={"gateway-"+detail.id} project={project} release={detail} onChange={refresh}/>}
      <DependencyPanel release={detail}/>
      <div className="checks">
        {detail.checks.map((c) => (
          <span key={c.label}>
            <CheckCircle2 size={15} />
            {c.label}
          </span>
        ))}
      </div>
      <details
        className="panel detail-disclosure"
        id="build-files"
        tabIndex={-1}
      >
        <summary>
          <ChevronRight size={15} />
          <FileCode2 size={17} />
          {t("构建文件")}<span>{detail.files.length}</span>
        </summary>
        <div className="detail-section-body">
          <div className="file-list">
            {detail.files.map((f) => (
              <div key={f.path}>
                <FileCode2 size={14} />
                <code>{f.path}</code>
                <span>{bytes(f.bytes)}</span>
                <code className="file-hash" title={f.sha256}>
                  {short(f.sha256, 12)}
                </code>
              </div>
            ))}
          </div>
          <div className="manifest">
            <span>Manifest SHA-256</span>
            <code>{detail.manifestHash}</code>
            <button
              className="icon-button"
              aria-label={t("复制清单哈希")}
              onClick={() =>
                void run(
                  t("复制清单哈希"),
                  () => navigator.clipboard.writeText(detail.manifestHash),
                  t("哈希已复制"),
                )
              } disabled={project?.role==='viewer'}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
      </details>
      <details
        className="panel detail-disclosure"
        id="cloud-publish"
        tabIndex={-1}
      >
        <summary>
          <ChevronRight size={15} />
          <Cloud size={17} />
          {t("Cloudflare 发布")}</summary>
        <div className="detail-section-body">
          <p className="muted small-text">
            {t("预览用于分享。生产镜像会更新 Pages 主分支和绑定域名；链上文件独立发布与核验。生产核验覆盖服务端和当前访问节点，其他地区、自定义域名和 Service Worker 需另验。")}</p>
          {hasVersionedSites(detail.projectId) && <div className="notice versioned-site-panel">
            <strong>{t("TapeNow 版本入口")}</strong>
            <p>{t("稳定网址会进入当前版本的独立网址。恢复旧版时，页面、资源与 Service Worker 随版本隔离；现有页面需重新打开稳定网址才能切换。原文件保持不变，链上发布独立进行。")}</p>
            {detail.site && <div className="versioned-site-links"><External href={detail.site.stableUrl}>{t("稳定入口")}</External><External href={detail.site.url}>{t("此版本固定入口")}</External></div>}
            <button className="button secondary" disabled={project?.role==='viewer'||(!!busy)} onClick={()=>void run(t("发布版本入口"),()=>publishVersionedSite(detail),t("版本入口已切换"))}>{t("将此版本设为访问入口")}</button>
            {detail.site?.status==='pending-access-check'&&<button className="button secondary" disabled={project?.role==='viewer'||(!!busy)} onClick={()=>void run(t("核验版本入口"),()=>publishVersionedSite(detail,true),t("当前节点逐文件访问已通过"))}>{t("重试访问核验")}</button>}
          </div>}
          <div className="cloud-prerequisites">
            {["preview", "production"].map((environment) => (
              <button
                key={environment}
                className="text-button"
                disabled={!!busy}
                onClick={() =>
                  connect("cloudflare", detail.projectId, environment)
                }
              >
                <Plug size={14} />
                {environment === "preview" ? t("预览账号") : t("生产账号")}：
                {data.connections[
                  `${detail.projectId}:cloudflare:${environment}`
                ]
                  ? t("已连接 · 管理")
                  : t("未连接 · 去连接")}
              </button>
            ))}
          </div>
          {detail.cloudflareProduction && (
            <div className="cloud-link">
              <Badge tone={detail.cloudflareProduction.status === "success" ? "teal" : "neutral"}>
                {t("生产镜像 ·")}{detail.cloudflareProduction.status === "success" ? t("已核验") : t("待核验")}
              </Badge>
              <External
                href={
                  "https://" +
                  detail.cloudflareProduction.projectName +
                  ".pages.dev"
                }
                className="text-button"
              >
                {detail.cloudflareProduction.projectName}.pages.dev
              </External>
            </div>
          )}
          {detail.cloudflare && (
            <div className="cloud-link">
              <Badge tone={detail.cloudflare.status === "success" ? "teal" : "neutral"}>{detail.cloudflare.status === "success" ? t("已核验") : t("待核验")}</Badge>
              <External href={detail.cloudflare.url} className="text-button">
                {new URL(detail.cloudflare.url).hostname}
              </External>
            </div>
          )}
          {[{record:detail.cloudflare,production:false},{record:detail.cloudflareProduction,production:true}].map(({record,production}) => record?.status.startsWith("pending-") && (
            <Notice key={String(production)}>
              <p>{record.error || t("部署已上传，等待访问核验。")}</p>
              {production && <p><External href={record.url} className="text-button">{t("打开此次部署的固定版本地址")}</External></p>}
              <button className="button secondary" disabled={project?.role==='viewer'||(!!busy)} onClick={()=>void run(t("核验 Cloudflare 入口"),()=>cloudflareOperation(detail,production,false),t("入口核验通过"))}>
                {t("重试核验")}{production ? t("生产镜像") : t("预览")}
              </button>
            </Notice>
          ))}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={project?.role==='viewer'||(!!busy)}
              onClick={() =>
                void run(
                  t("部署到 Cloudflare 预览"),
                  () => cloudflareOperation(detail,false),
                  t("Cloudflare 预览已部署"),
                )
              }
            >
              <Cloud size={15} />
              {t("部署公开预览")}</button>
            <button
              className="button secondary"
              disabled={project?.role==='viewer'||(!!busy)}
              onClick={() =>
                void run(
                  t("部署 Cloudflare 生产镜像"),
                  () =>
                    cloudflareOperation(detail,true),
                  t("Cloudflare 生产镜像已部署"),
                )
              }
            >
              {t("发布生产镜像")}<ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </details>
      <details
        className="panel detail-disclosure"
        id="chain-publish"
        tabIndex={-1}
        open
      >
        <summary>
          <ChevronRight size={15} />
          <Hexagon size={18} />{t("链上发布")}{" "}
          <Badge tone={detail.chainStatus === "verified" ? "teal" : "neutral"}>
            {detail.chainStatus === "verified"
              ? t("逐文件已核验")
              : detail.chainStatus === "publishing"
                ? t("发布中")
                : t("待发布")}
          </Badge>
        </summary>
        <div className="detail-section-body">
          <p className="muted small-text">
            {t("钱包所有权检查 → 交易签名 → 链上逐文件读回。使用独立容器，避免覆盖已有网站。")}</p>
          <MobileChainNotice />
          {!plan ? (
            <button
              className="button secondary"
              disabled={project?.role==='viewer'||(!!busy)}
              onClick={() =>
                void run(t("读取链上信息并准备计划"), () => prepare(detail))
              }
            >
              <Wallet size={15} />
              {t("生成发布计划")}</button>
          ) : (
            <>
              <div className="plan-summary">
                <div>
                  <span>{t("合约费用（不含 gas）")}</span>
                  <strong>{plan.valueNative??plan.valueOKB} {plan.nativeSymbol||(network(plan.chainId).symbol)}</strong>
                </div>
                <div>
                  <span>{t("交易进度")}</span>
                  <strong>
                    {plan.completed.length} / {plan.steps.length}
                  </strong>
                </div>
              </div>
              {plan.completed.length === 0 &&
                !plan.pending &&
                !plan.signing && (
                  <button
                    className="text-button"
                    disabled={project?.role==='viewer'||(!!busy)}
                    onClick={() =>
                      void run(t("刷新未开始的发布计划"), () => prepare(detail))
                    }
                  >
                    <RefreshCw size={14} />
                    {t("刷新未开始的计划")}</button>
                )}
              <code className="container-address">{t("容器")}{plan.container}</code>
              <p className="muted small-text">{plan.gasQuote}</p>
              <div className="plan-steps">
                {plan.steps.map((s, i) => (
                  <div key={i}>
                    <span
                      className={
                        "mini-step " + (i < plan.completed.length ? "done" : "")
                      }
                    >
                      {i < plan.completed.length ? <Check size={12} /> : i + 1}
                    </span>
                    <span>
                      {s.kind}
                      {s.path ? " · " + s.path : ""}
                    </span>
                    {plan.completed[i] && (
                      <External
                        className="text-button"
                        href={
                          "https://www.oklink.com/xlayer/tx/" +
                          plan.completed[i].hash
                        }
                      >
                        {t("交易")}</External>
                    )}
                  </div>
                ))}
              </div>
              <div className="button-row">
                {plan.completed.length < plan.steps.length ? (
                  <button
                    className="button primary"
                    disabled={project?.role==='viewer'||(!!busy)}
                    onClick={() =>
                      void run(t("签名并确认交易"), () => signStep(detail))
                    }
                  >
                    <Wallet size={15} />
                    {plan.pending?.index === plan.completed.length
                      ? t("检查待确认交易")
                      : t("在钱包签署第 ") + (plan.completed.length + 1) + t(" 笔")}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={project?.role==='viewer'||(!!busy)}
                    onClick={() =>
                      void run(
                        t("逐文件链上读回"),
                        () =>
                          api("/releases/" + detail.id + "/chain/readback", {}),
                        t("链上文件与本地清单完全一致"),
                      )
                    }
                  >
                    <ShieldCheck size={16} />
                    {t("读回并验证全部文件")}</button>
                )}
              </div>
              <Notice>
                {t("文件核验完成后，可单独准备 30 天的 TapeKit 入口激活。激活费用以合约读取和钱包显示为准。")}</Notice>
            </>
          )}
          {plan?.signing && !plan.pending && (
            <form
              className="recovery-form"
              onSubmit={(e) => {
                const f = form(e);
                void run(t("恢复待确认交易"), async () => {
                  await api("/releases/" + detail.id + "/chain/pending", {
                    index: plan.completed.length,
                    hash: f.hash,
                  });
                  setPlan(await api("/releases/" + detail.id + "/chain/plan"));
                });
              }}
            >
              <Notice tone="warning">
                {t("上一笔签署结果未知。请从钱包中复制交易哈希，恢复后只检查这笔交易，不重新发送。")}</Notice>
              <label>
                {t("交易哈希")}<input
                  name="hash"
                  placeholder="0x…"
                  required
                  pattern="0x[a-fA-F0-9]{64}"
                />
              </label>
              <button className="button secondary" disabled={project?.role==='viewer'||(!!busy)}>
                {t("恢复交易记录")}</button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  void run(t("取消未发送的签署"), async () => {
                    await api("/releases/" + detail.id + "/chain/rejected", {});
                    setPlan(
                      await api("/releases/" + detail.id + "/chain/plan"),
                    );
                  })
                } disabled={project?.role==='viewer'}
              >
                {t("我已核实：钱包没有发送这笔交易")}</button>
            </form>
          )}
          {detail.chainStatus === "verified" && !detail.activation?.live && (
            <button
              className="button secondary"
              disabled={project?.role==='viewer'||(!!busy)}
              onClick={() =>
                void run(t("读取 TapeKit 激活费用"), async () =>
                  setPlan(
                    await api(
                      "/releases/" + detail.id + "/chain/activation",
                      {},
                    ),
                  ),
                )
              }
            >
              <Globe size={15} />
              {t("准备激活 TapeKit 入口")}</button>
          )}
          {detail.activation?.live && (
            <div className="cloud-link">
              <Badge tone="teal">{t("合约已激活")}</Badge>
              <External href={detail.activation.url} className="text-button">
                {t("访问 TapeKit 入口")}</External>
            </div>
          )}
          {detail.verification && (
            <div className="verified-result">
              <ShieldCheck size={20} />
              <div>
                <strong>{t("文件内容已经过链上读回验证")}</strong>
                <small>
                  {t("区块")}{" "}
                  {String(
                    detail.verification.blockNumber ||
                      detail.verification.block ||
                      "",
                  )}{" "}
                  {t("· SHA-256 与归档一致")}</small>
              </div>
            </div>
          )}
        </div>
      </details>
      <details
        className="panel detail-disclosure"
        id="release-receipts"
        tabIndex={-1}
      >
        <summary>
          <ChevronRight size={15} />
          <PackageCheck size={17} />
          {t("版本与回执")}</summary>
        <div className="detail-section-body">
          <div className="button-row">
            <button
              className="button secondary"
              disabled={project?.role==='viewer'}
              onClick={() => setConfirm({ type: "promote", r: detail })}
            >
              <Check size={15} />
              {t("设为当前版本")}</button>
            <button
              className="button secondary"
              disabled={project?.role==='viewer'}
              onClick={() => setConfirm({ type: "restore", r: detail })}
            >
              <RotateCcw size={15} />
              {t("恢复此版本")}</button>
            <button
              className="button secondary"
              disabled={!!busy||!!project?.role&&project.role!=="owner"}
              onClick={() =>
                void run(
                  t("重新校验归档"),
                  () => api("/releases/" + detail.id + "/verify", {}),
                  t("文件归档完整性检查通过"),
                )
              }
            >
              <ShieldCheck size={15} />
              {t("核验归档")}</button>
            {(!project?.role||project.role==="owner")&&<><a
              className="button secondary"
              href={"/api/releases/" + detail.id + "/export"}
              download
            >
              <Download size={15} />
              {t("导出构建与回执")}</a>
            <External
              href={"/api/releases/" + detail.id + "/receipt"}
              className="text-button"
            >
              {t("查看签名回执")}</External></>}
          </div>
          <p className="muted small-text">
            {t("回执由")}{isCloud() ? t("平台") : t("本机")} {t("Ed25519 密钥签名，证明这份记录未被修改；它不是第三方审计认证。")}</p>
        </div>
      </details>
    </div>
  ) : null;
  if (!loaded)
    return (
      <div className="boot">
        <Brand />
        {error ? (
          <>
            <p>{translateMessage(error)}</p>
            <button onClick={() => void boot()} className="button primary">
              {t("重新连接")}</button>
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            <p>{t("准备你的工作台…")}</p>
          </>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label={t("收起菜单")}
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="project-navigation"
        className={"sidebar " + (mobile ? "open" : "")}
      >
        <button
          className="workspace-identity"
          onClick={() => navigate("overview", "")}
          aria-label={t("TapeNow 首页")}
        >
          <Brand />
          <Badge>{isCloud() ? "Beta" : "Local"}</Badge>
        </button>
        <button
          className="sidebar-find"
          onClick={() => {
            setMobile(false);
            setCommandQuery("");
            setModal("find");
          }} disabled={project?.role==='viewer'}
        >
          <Search size={16} />
          <span>{t("查找…")}</span>
          <kbd>⌘ K</kbd>
        </button>
        {project && route.view === "settings" ? (
          <nav aria-label={t("设置导航")}>
            <button className="nav-item" onClick={() => navigate("overview")}>
              <ArrowLeft size={17} />
              {t("返回项目")}</button>
            <div className="nav-divider" />
            <button
              className={
                "nav-item " + (settingsSection === "general" ? "active" : "")
              }
              onClick={() => {
                navigate("settings");
                setMobile(false);
              }}
            >
              {t("常规")}</button>
            <button
              className={
                "nav-item " + (settingsSection === "chain" ? "active" : "")
              }
              onClick={() => {
                navigate("settings", project.id, "", "chain");
                setMobile(false);
              }}
            >
              {t("链上发布目标")}</button>
            {[
              ["git", "Git"],
              ["delivery", t("构建与部署")],
            ].map(([section, label]) => (
              <button
                key={section}
                className={
                  "nav-item " + (settingsSection === section ? "active" : "")
                }
                onClick={() => navigate("settings", project.id, "", section)}
              >
                {label}
              </button>
            ))}
            <button className="nav-item" onClick={() => navigate("data")}>
              {t("存储与数据")}</button>
            <button
              className="nav-item"
              onClick={() => navigate("environment")}
            >
              {t("环境变量")}</button>
            <button className="nav-item" onClick={() => navigate("domains")}>
              {t("域名")}</button>
            <button className="nav-item" onClick={() => navigate("storage")}>
              {t("服务集成")}</button>
          </nav>
        ) : route.view === "logs" ? (
          <nav aria-label={t("日志筛选")}>
            <button className="nav-item" onClick={() => navigate("overview")}>
              <ArrowLeft size={17} />
              {project ? t("返回项目") : t("返回所有项目")}
            </button>
            <div className="nav-divider" />
            <div className="sidebar-section-title">{t("筛选")}</div>
            <div className="sidebar-filter-title">{t("事件级别")}</div>
            {[
              ["all", t("全部事件")],
              ["success", t("成功")],
              ["info", t("信息")],
              ["error", t("错误")],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={"nav-item " + (filter === value ? "active" : "")}
                onClick={() => setFilter(value)}
              >
                <span
                  className={
                    "filter-check " + (filter === value ? "selected" : "")
                  }
                >
                  {filter === value && <Check size={11} />}
                </span>
                {label}
                <span className="nav-count">
                  {
                    data.logs.filter(
                      (l) =>
                        (!project || l.projectId === project.id) &&
                        (value === "all" || l.level === value),
                    ).length
                  }
                </span>
              </button>
            ))}
            <p className="sidebar-note">
              {t("工作台操作记录。应用运行时日志尚未接入。")}</p>
          </nav>
        ) : (
          <nav aria-label={project ? t("项目导航") : t("工作空间导航")}>
            {navigation
              .filter(
                (n) =>
                  (!["invitations","feedback"].includes(n.id)||getSession().operator) && (project ||
                  [
                    "overview",
                    "deployments",
                    "logs",
                    "storage",
                    "usage", "invitations", "feedback",
                  ].includes(n.id)),
              )
              .map((n) => (
                <div key={n.id}>
                  {["environment", "usage"].includes(n.id) && (
                    <div className="nav-divider" />
                  )}
                  <button
                    className={
                      "nav-item " + (route.view === n.id ? "active" : "")
                    }
                    aria-current={route.view === n.id ? "page" : undefined}
                    onClick={() => navigate(n.id)}
                  >
                    <n.icon size={17} />
                    {n.id === "overview"
                      ? project
                        ? t("概览")
                        : t("项目")
                      : !project && n.id === "storage"
                        ? t("集成")
                        : n.label}
                    {n.id === "deployments" && (
                      <span className="nav-count">{releases.length}</span>
                    )}
                    {n.id === "settings" && <ChevronRight size={14} />}
                  </button>
                </div>
              ))}
            <button className="nav-item" onClick={() => openGuide("start")}>
              <BookOpen size={17} />
              {t("帮助与指南")}</button>
            <a className="nav-item" href="/docs/manual/" target="_blank" rel="noopener noreferrer">
              <BookOpen size={17} />
              {t("用户手册")}</a>
          </nav>
        )}
        <div className="sidebar-bottom">
          <span className="avatar">S</span>
          <span>
            TapeNow <small>{isCloud() ? t("云端工作空间") : t("本地工作空间")}</small>
          </span>
          <span className="ready-dot" title={t("工作空间已连接")} />
        </div>
      </aside>
      <div className="main-shell" inert={mobile}>
        <header className="topbar">
          <div className="project-switcher">
            <button
              className="icon-button mobile-toggle"
              aria-expanded={mobile}
              aria-controls="project-navigation"
              aria-label={t("打开菜单")}
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            {project && (
              <button
                className="icon-button back-projects"
                onClick={() => navigate("overview", "")}
                aria-label={t("返回所有项目")}
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <Hexagon size={17} />
            <select
              aria-label={t("选择项目")}
              value={project?.id || ""}
              onChange={(e) => navigate("overview", e.target.value)}
            >
              <option value="">{t("所有项目")}</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
          <div className="header-location">
          {detailId ? (
              <>
                <button onClick={() => navigate("deployments")}>{t("部署")}</button>
                <span>/</span>
                <code>{short(detailId, 14)}</code>
              </>
            ) : (
              navigation.find((n) => n.id === route.view)?.label
            )}
          </div>
          <div className="topbar-actions"><WorkspaceSwitch/><LanguageSwitcher/><AccountMenu/>
            <button
              className="topbar-help"
              aria-label={t("打开使用指南")}
              onClick={() => openGuide("start")}
            >
              <BookOpen size={16} />
              <span>{t("指南")}</span>
            </button>
            <a className="topbar-help topbar-manual" href="/docs/manual/" target="_blank" rel="noopener noreferrer" aria-label={t("打开用户手册")}>
              <BookOpen size={16} /><span>{t("用户手册")}</span>
            </a>
            <FeedbackButton />
            <button
              className="wallet-button"
              onClick={() => void run(t("连接钱包"), connectWallet)}
              title={wallet || t("连接钱包")}
              disabled={project?.role==='viewer'||(!!busy)}
            >
              <Wallet size={16} />
              <span>
                {wallet
                  ? short(wallet, 6) + "…" + wallet.slice(-4)
                  : t("连接钱包")}
              </span>
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={
            "main-content view-" + route.view + (detailId ? " view-detail" : "")
          }
        >
          <WebMCPBridge routeKey={window.location.hash} onChanged={refresh} currentRole={project?.role} sharedPublisher={data.projects.some(p=>p.role==='publisher')} currentWallet={wallet}/>
          {!detailId&&<BetaNotice/>}
          {project?.role&&<Notice>{t("当前项目角色")} · {project.role==="viewer"?t("只读成员 · Viewer"):project.role==="publisher"?t("发布者 · Publisher"):t("所有者")}</Notice>}
          {detailId ? (
            deploymentPage || (
              <Empty
                icon={<Layers />}
                title={t("没有找到这次部署")}
                action={
                  <button
                    className="button secondary"
                    onClick={() => navigate("deployments")}
                  >
                    {t("返回部署列表")}</button>
                }
              >
                {t("记录可能已移除，请从列表重新选择。")}</Empty>
            )
          ) : route.view === "storage" ? (
            <><IntegrationsPage
              data={data}
              project={project}
              busy={!!busy}
              onConnect={connect}
              onManage={manageService}
              onDisconnect={disconnect}
              onChanged={refresh}
              onCreate={() => {
                setGuidedCreate(false);
                setProjectSource("upload");
                setModal("project");
              }}
            />{project && <><SourcePanel key={project.id} project={project} data={data} onConnect={connect} onChanged={refresh}/><RuntimePanel key={project.id+"-runtime"} project={project}/></>}</>
          ) : route.view === "invitations" ? (<InvitationPage/>) : route.view === "feedback" ? (<FeedbackAdminPage/>) : !project ? (
            <>{route.view==="overview"&&<FirstUse data={data} onCreate={()=>{setGuidedCreate(false);setProjectSource("upload");setModal("project");}} onGuide={()=>openGuide()} onChanged={refresh}/>}<WorkspaceHome
              data={data}
              view={route.view}
              logLevel={filter}
              onView={(view) => navigate(view, "")}
              search={search}
              onSearch={setSearch}
              searchRef={searchRef}
              onCreate={() => {
                setGuidedCreate(false);
                setProjectSource("upload");
                setModal("project");
              }}
              onProject={(p) => navigate("overview", p.id)}
              onRelease={openRelease}
              onGuide={openGuide}
            /></>
          ) : (
            <>
              {!["overview", "settings", "domains", "logs", "data", "usage", "archives"].includes(
                route.view,
              ) && (
                <div className="page-heading project-heading">
                  <div>
                    <h1>
                      {navigation.find((n) => n.id === route.view)?.label}
                    </h1>
                    {route.view === "environment" && (
                      <p>{t("管理项目的配置备忘和加密凭证。")}</p>
                    )}
                  </div>
                  <div className="heading-actions">
                    {route.view === "deployments" && (
                      <button
                        className="button secondary"
                        onClick={() => manageService("github", project.id)}
                      >
                        <GitBranch size={15} />
                        {t("GitHub 构建")}</button>
                    )}
                    {route.view === "deployments" && (
                      <button
                        className="button primary"
                        onClick={() => setModal("import")} disabled={project?.role==='viewer'}
                      >
                        <Plus size={15} />
                        {t("导入构建")}</button>
                    )}
                    {route.view === "environment" && (
                      <button
                        className="button primary"
                        onClick={() => setModal("env")} disabled={project?.role==='viewer'}
                      >
                        <Plus size={15} />
                        {t("添加环境变量")}</button>
                    )}
                  </div>
                </div>
              )}
              {route.view === "overview" && (
                <ProjectOverview
                  project={project}
                  data={data}
                  releases={releases}
                  production={production}
                  onImport={() => setModal("import")}
                  onRelease={openRelease}
                  onNavigate={navigate}
                  onManageService={manageService}
                  onGuide={() => openGuide("start")}
                />
              )}
              {route.view === "deployments" && (
                <>
                  <div className="section-toolbar">
                    <div className="search-box">
                      <Search size={16} />
                      <input
                        ref={searchRef}
                        aria-label={t("搜索部署")}
                        placeholder={searchPlaceholder}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label={t("部署筛选")}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">{t("所有部署")}</option>
                      <option value="current">{t("当前版本")}</option>
                      <option value="chain">{t("链上已核验")}</option>
                    </select>
                  </div>
                  <DeploymentList
                    items={selectedReleases}
                    data={data}
                    onOpen={openRelease}
                  />
                  <div className="soft-note">
                    <RotateCcw size={16} />
                    <p>
                      {t("恢复会创建一个新版本，保留完整历史。数据库中的用户数据不会随网站版本一起回退。")}</p>
                  </div>
                </>
              )}
              {route.view === "logs" && (
                <>
                  <div className="section-toolbar">
                    <div className="search-box">
                      <Search size={16} />
                      <input
                        ref={searchRef}
                        aria-label={t("搜索日志")}
                        placeholder={t("搜索活动日志…")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label={t("日志级别")}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">{t("所有级别")}</option>
                      <option value="success">{t("成功")}</option>
                      <option value="info">{t("信息")}</option>
                      <option value="error">{t("错误")}</option>
                    </select>
                  </div>
                  <section className="panel log-panel">
                    <div className="log-header">
                      <span>{t("时间")}</span>
                      <span>{t("级别")}</span>
                      <span>{t("事件")}</span>
                    </div>
                    {logItems.length ? (
                      logItems.map((l) => (
                        <div className="log-row" key={l.id}>
                          <time>{date(l.at)}</time>
                          <Badge
                            tone={
                              l.level === "success"
                                ? "teal"
                                : l.level === "error"
                                  ? "coral"
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
                                  if (r) openRelease(r);
                                }}
                              >
                                {l.releaseId}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <Empty icon={<Activity />} title={t("没有匹配的事件")}>
                        {t("换个关键词试试。")}</Empty>
                    )}
                  </section>
                  <p className="muted small-text">
                    {t("记录本工作台的部署操作，不收集项目网站访客的隐私数据或应用运行时日志。")}</p>
                </>
              )}
              {route.view === "team" && <TeamPanel project={project}/>}
              {route.view === "ecosystem" && <EcosystemPage project={project} data={data} onChange={refresh} onRelease={openRelease} wallet={wallet}/>}
              {route.view === "data" && (
                <><PostgresPanel project={project}/><StoragePage
                  data={data}
                  project={project}
                  busy={!!busy}
                  onConnect={connect}
                  onIntegrations={() => navigate("storage")}
                  onChanged={refresh}
                /></>
              )}
              {route.view === "domains" && (
                <>
                  <GatewayPanel key={"gateway-domain-"+project.id} project={project} onChange={refresh}/>
                  <div className="section-toolbar">
                    <div className="search-box">
                      <Search size={16} />
                      <input
                        ref={searchRef}
                        aria-label={t("搜索域名")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("搜索域名…")}
                      />
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setModal("domain")} disabled={project?.role==='viewer'}
                    >
                      <Plus size={15} />
                      {t("添加域名")}</button>
                  </div>
                  <section className="panel">
                    {data.domains.filter(
                      (d) =>
                        d.projectId === project.id &&
                        d.hostname.toLowerCase().includes(search.toLowerCase()),
                    ).length ? (
                      data.domains
                        .filter(
                          (d) =>
                            d.projectId === project.id &&
                            d.hostname
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )
                        .map((d) => (
                          <div key={d.id}><div className="domain-row">
                            <span className="domain-icon">
                              <Globe size={21} />
                            </span>
                            <div className="domain-info">
                              <strong>{d.hostname}</strong>
                              <span>{d.provider==="hashport"&&translateMessage(d.detail)===t("已登记。需要 Cloudflare Pages 真实部署与域名 DNS 配置。")?t("已登记。需要完成 BSC 文件发布、域名链上绑定、DNS 配置与 HTTPS 内容核验。"):translateMessage(d.detail)}</span>
                              {d.target && <code>CNAME → {d.target}</code>}
                            </div>
                            <Badge
                              tone={["active","verified"].includes(d.status) ? "teal" : "coral"}
                            >
                              {["active","verified"].includes(d.status) ? t("已激活") : t("待配置")}
                            </Badge>
                            {d.provider!=="hashport"&&d.provider!=="gateway"&&<button
                              className="button secondary"
                              disabled={project?.role==='viewer'||(!!busy)}
                              onClick={() =>
                                void run(
                                  t("检查域名"),
                                  () =>
                                    api("/domains/" + d.id + "/connect", {}),
                                  t("域名状态已从 Cloudflare 更新"),
                                )
                              }
                            >
                              <RefreshCw size={14} />
                              {t("检查连接")}</button>}
                            {d.status !== "active" && (
                              <button
                                className="icon-button"
                                aria-label={t("移除 ") + d.hostname}
                                onClick={() =>
                                  void run(t("移除域名"), () =>
                                    api("/domains/" + d.id, {}, "DELETE"),
                                  )
                                } disabled={project?.role==='viewer'}
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div><DomainControls domain={d} project={project} data={data} onChange={refresh} onRelease={openRelease}/></div>
                        ))
                    ) : (
                      <Empty
                        icon={<Globe size={32} />}
                        title={search ? t("没有匹配的域名") : t("添加你的第一个域名")}
                      >
                        {t("先发布 Gateway 固定版本、Cloudflare 生产镜像或 BSC HashPort 网站，再登记域名、确认 DNS 并核验访问。")}</Empty>
                    )}
                  </section>
                  <div className="split-panels">
                    <section className="panel info-panel">
                      <Cloud size={23} />
                      <h3>{t("自定义域名")}</h3>
                      <p>
                        {t("TapeNow Gateway 域名连接 BSC、X Layer 或 Base 的固定版本；Cloudflare Pages 连接生产镜像；HashPort 连接 BSC 链上文件。配置 DNS 后还需核验证书与内容，登记成功不代表访问已生效。")}</p>
                    </section>
                    <section className="panel info-panel">
                      <Hexagon size={23} />
                      <h3>{t("链上文件地址")}</h3>
                      <p>
                        {t("链上发布完成后，详情页保留容器、交易和逐文件读回凭证。原生 TapeKit 入口可在文件核验后独立激活。")}</p>
                    </section>
                  </div>
                </>
              )}
              {route.view === "usage" && <><DiagnosticsPage key={project.id} project={project}/><CostSources project={project} data={data}/></>}
              {route.view === "archives" && <ArchivesPage key={project.id} project={project} onChanged={refresh}/>}
              {route.view === "settings" && (
                <div
                  className={"settings-stack settings-" + settingsSection}
                  key={project.id}
                >
                  {settingsSection === "general" && (
                    <form
                      className="panel settings-panel"
                      onSubmit={(e) => {
                        const f = form(e);
                        void run(
                          t("保存项目"),
                          () =>
                            api(
                              "/projects/" + project.id,
                              { name: f.name, description: f.description },
                              "PATCH",
                            ),
                          t("项目设置已保存"),
                        );
                      }}
                    >
                      <div className="panel-heading">
                        <h2>{t("项目基本信息")}</h2>
                      </div>
                      <div className="form-grid">
                        <label>
                          {t("项目名称")}<input
                            name="name"
                            defaultValue={project.name}
                            minLength={2}
                            maxLength={60}
                            required
                          />
                        </label>
                        <label>
                          {t("一句话介绍")}<input
                            name="description"
                            defaultValue={project.description}
                            maxLength={200}
                          />
                        </label>
                      </div>
                      <div className="settings-footer">
                        <span>
                          {t("项目 ID")}<code>{project.id}</code>
                        </span>
                        <button className="button primary" disabled={project?.role==='viewer'||(!!busy)}>
                          {t("保存")}</button>
                      </div>
                    </form>
                  )}
                  {settingsSection === "chain" && (
                    <form
                      className="panel settings-panel"
                      onSubmit={(e) => {
                        const f = form(e);
                        void run(
                          t("保存链上目标"),
                          () =>
                            api(
                              "/projects/" + project.id,
                              {
                                chain: {
                                  chainId: Number(f.chainId),
                                  cpuIndex: f.cpuIndex,
                                  tokenId: f.tokenId,
                                },
                              },
                              "PATCH",
                            ),
                          t("发布目标已保存"),
                        );
                      }}
                    >
                      <div className="panel-heading">
                        <h2>{t("链上发布目标")}</h2>
                        <Badge tone="teal">{network(project.chain.chainId).name+" · "+network(project.chain.chainId).symbol}</Badge>
                      </div>
                      <p className="settings-description">
                        {t("使用你拥有的 TapeOut 处理器芯片作为容器。建议为本 Demo 使用独立芯片。")}</p>
                      <label>{t("发布网络")}<select name="chainId" defaultValue={project.chain.chainId}><option value="196">X Layer · OKB</option><option value="56">BNB Smart Chain · BNB</option><option value="8453">Base · ETH</option></select></label>
                      <div className="form-grid">
                        <label>
                          {t("处理器编号 · CPU Index")}<input
                            name="cpuIndex"
                            inputMode="numeric"
                            pattern="[0-9]+"
                            defaultValue={project.chain.cpuIndex}
                            placeholder={t("例如 123")}
                            required
                          />
                        </label>
                        <label>
                          {t("芯片编号 · Token ID")}<input
                            name="tokenId"
                            inputMode="numeric"
                            pattern="[0-9]+"
                            defaultValue={project.chain.tokenId}
                            placeholder={t("例如 1")}
                            required
                          />
                        </label>
                      </div>
                      <div className="settings-footer">
                        <span>{t("发布前会核对钱包所有权、文件和合约。")}</span>
                        <button className="button primary" disabled={project?.role==='viewer'||(!!busy)}>
                          {t("保存目标")}</button>
                      </div>
                    </form>
                  )}
                  {settingsSection === "git" && (
                    <>
                      <SourcePanel key={project.id} project={project} data={data} onConnect={connect} onChanged={refresh}/>
                      <details className="source-options">
                        <summary>{t("导入已有的旧版构建产物（可选）")}</summary>
                        <GitSettings
                          data={data}
                          project={project}
                          busy={!!busy}
                          onConnect={connect}
                          onImport={() => importGitHub(project.id)}
                        />
                      </details>
                    </>
                  )}
                  {settingsSection === "delivery" && (
                    <DeliverySettings
                      data={data}
                      project={project}
                      busy={!!busy}
                      onConnect={connect}
                      onRelease={openRelease}
                      onImport={() => setModal("import")}
                      onGit={() => manageService("github", project.id)}
                    />
                  )}
                </div>
              )}
              <ContextGuide
                view={route.view}
                onLearn={(topic) => openGuide("features", topic)}
              />
            </>
          )}
          <footer className="main-footer">
            <span>
              <Brand />
            </span>
            <button className="text-button" onClick={() => openGuide("faq")}>
              {t("帮助与常见问题")}<ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>
      {busy && (
        <div className="busy-bar" role="status">
          <Loader2 size={16} className="spin" />
          {busy}…
        </div>
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? (
            <AlertTriangle size={19} />
          ) : (
            <CheckCircle2 size={19} />
          )}
          <span>{translateMessage(toast.text)}</span>
          <button
            className="icon-button"
            aria-label={t("关闭提示")}
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal === "find" && (
        <Modal title={t("查找")} onClose={closeModal}>
          <div className="command-search">
            <Search size={18} />
            <input
              aria-label={t("查找项目或功能")}
              autoFocus
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder={t("搜索项目或功能…")}
            />
          </div>
          <div className="command-results">
            <span className="field-label">{t("项目")}</span>
            {data.projects
              .filter((p) =>
                p.name.toLowerCase().includes(commandQuery.toLowerCase()),
              )
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    navigate("overview", p.id);
                    closeModal();
                  }}
                >
                  <Hexagon size={16} />
                  {p.name}
                  <ArrowRight size={14} />
                </button>
              ))}
            <span className="field-label">{t("功能")}</span>
            {navigation
              .filter(
                (n) =>
                  (!["invitations","feedback"].includes(n.id)||getSession().operator) && (project ||
                    [
                      "overview",
                      "deployments",
                      "logs",
                      "storage",
                      "usage", "invitations", "feedback",
                    ].includes(n.id)) &&
                  (n.label + " " + n.id)
                    .toLowerCase()
                    .includes(commandQuery.toLowerCase()),
              )
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    navigate(n.id);
                    closeModal();
                  }}
                >
                  <n.icon size={16} />
                  {n.label}
                  <ArrowRight size={14} />
                </button>
              ))}
            <span className="field-label">{t("服务与连接")}</span>
            {providers
              .filter((p) =>
                (p.name + " " + p.keywords)
                  .toLowerCase()
                  .includes(commandQuery.trim().toLowerCase()),
              )
              .map((p) => (
                <button
                  key={p.id}
                  aria-label={(project ? t("管理 ") : t("连接 ")) + p.name + t(" 服务")}
                  onClick={() => {
                    closeModal();
                    if (project) manageService(p.id, project.id);
                    else connect(p.id, "");
                  }}
                >
                  <p.icon size={16} />
                  {p.name}
                  <span className="muted">
                    {project ? t("管理项目连接") : t("选择项目并连接")}
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            <button onClick={() => openGuide("features")}>
              <BookOpen size={16} />
              {t("使用指南与功能介绍")}<ArrowRight size={14} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "project" && (
        <Modal
          title={guidedCreate ? t("创建你的第一个体验项目") : t("创建新项目")}
          kicker="START SOMETHING GOOD"
          onClose={closeModal}
          busy={!!busy}
        >
          <form
            onSubmit={(e) => {
              const f = form(e);
              void run(
                t("创建项目"),
                async () => {
                  const p = await api<Project>("/projects", {
                    name: f.name,
                    description: f.description,
                  });
                  setGuidedCreate(false);
                  if (projectSource === "github" || projectSource === "vercel") {
                    manageService("github", p.id);
                    connect(projectSource as Provider, p.id);
                  } else {
                    navigate("overview", p.id);
                    setModal("import");
                    if (projectSource === "sample") {
                      const r = await api<Release>(
                        "/projects/" + p.id + "/sample",
                        { version: 1 },
                      );
                      setModal(null);
                      openRelease(r);
                    }
                  }
                },
                t("项目已创建"),
              );
            }}
            className="modal-form"
          >
            <p className="muted">
              {guidedCreate && projectSource === "sample"
                ? t("给体验项目起个名字，创建后直接生成示例 v1，无需准备文件或连接钱包。")
                : t("选择网站来源并创建项目，随后完成对应的连接或导入。")}
            </p>
            <fieldset className="project-source-options">
              <legend>{t("从哪里开始？")}</legend>
              {[
                {
                  id: "github",
                  title: t("GitHub 仓库"),
                  text: t("连接仓库，导入 Actions 构建"),
                  icon: GitBranch,
                },
                {
                  id: "vercel",
                  title: t("Vercel 项目"),
                  text: t("检查兼容性，从源码重建导入"),
                  icon: GitBranch,
                },
                {
                  id: "upload",
                  title: t("上传构建包"),
                  text: t("选择 ZIP 或本地构建目录"),
                  icon: Upload,
                },
                {
                  id: "sample",
                  title: t("使用示例"),
                  text: t("生成示例 v1，获得独立预览"),
                  icon: PackageCheck,
                },
              ].map((source) => (
                <label
                  key={source.id}
                  className={projectSource === source.id ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="projectSource"
                    value={source.id}
                    checked={projectSource === source.id}
                    onChange={() => setProjectSource(source.id)}
                  />
                  <source.icon size={18} />
                  <span>
                    <strong>{source.title}</strong>
                    <small>{source.text}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              {t("项目名称")}<input
                name="name"
                defaultValue={guidedCreate ? "my-first-site" : ""}
                placeholder="my-next-big-thing"
                minLength={2}
                maxLength={60}
                required
                autoComplete="off"
              />
            </label>
            <label>
              {t("一句话介绍")}<span className="optional">{t("可选")}</span>
              <input
                name="description"
                placeholder={t("一个值得发布的好想法")}
                maxLength={200}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={closeModal} disabled={project?.role==='viewer'}
              >
                {t("取消")}</button>
              <button className="button primary" disabled={project?.role==='viewer'||(!!busy)}>
                {t("创建项目")}<ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "import" && project && (
        <ImportModal
          project={project}
          busy={!!busy}
          onClose={closeModal}
          onImport={(files, label) =>
            run(
              t("校验并导入构建"),
              async () => {
                let body: Record<string, unknown> = { label };
                if (files.length === 1 && files[0].name.endsWith(".zip"))
                  body.zip = await file64(files[0]);
                else {
                  body.files = await Promise.all(
                    files.map(async (f) => {
                      const rel = f.webkitRelativePath || f.name;
                      return {
                        path: f.webkitRelativePath
                          ? rel.split("/").slice(1).join("/")
                          : rel,
                        base64: await file64(f),
                      };
                    }),
                  );
                }
                const r = await api<Release>(
                  "/projects/" + project.id + "/import",
                  body,
                );
                setModal(null);
                openRelease(r);
              },
              t("构建已归档，预览已就绪"),
            )
          }
          onSample={(v) =>
            run(
              t("创建示例构建"),
              async () => {
                const r = await api<Release>(
                  "/projects/" + project.id + "/sample",
                  { version: v },
                );
                setModal(null);
                openRelease(r);
              },
              t("示例已就绪"),
            )
          }
        />
      )}
      {modal === "connect" && !manualConnection && (
        <OAuthConnect
          provider={provider}
          projects={data.projects}
          projectId={connectProjectId}
          environment={connectEnvironment}
          initialGrant={initialGrant}
          onClose={closeModal}
          onManual={() => setManualConnection(true)}
          onConnected={refresh}
        />
      )}
      {modal === "connect" && manualConnection && (
        <Modal
          title={t("连接 ") + names[provider]}
          kicker="BRING YOUR OWN SERVICES"
          onClose={closeModal}
          busy={!!busy}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              const f = form(e);
              void run(
                t("验证 ") + names[provider] + t(" 连接"),
                async () => {
                  await api("/connections", {
                    ...f,
                    provider,
                    projectId: f.projectId,
                  });
                  setModal(null);
                },
                t("连接已通过供应商 API 验证"),
              );
            }}
          >
            <Notice>
              {t("凭证仅保存到")}{isCloud() ? t("服务端") : t("本机")}{t("加密存储，不写入项目导出文件。供应商资源归你的账号所有。")}</Notice>
            <label>
              {t("所属项目")}<select
                name="projectId"
                required
                value={connectProjectId}
                onChange={(e) => setConnectProjectId(e.target.value)}
              >
                <option value="" disabled>
                  {t("选择要连接的项目")}</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {data.projects.length === 0 && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setProjectSource(provider === "github" ? "github" : "upload");
                  setGuidedCreate(false);
                  setModal("project");
                }} disabled={project?.role==='viewer'}
              >
                {t("先创建项目")}</button>
            )}
            <label>
              {provider === "github" ? t("连接用途") : t("环境")}
              <select
                name="environment"
                value={connectEnvironment}
                onChange={(e) => setConnectEnvironment(e.target.value)}
              >
                <option value="preview">
                  {provider === "github" ? t("项目构建来源") : t("预览环境")}
                </option>
                {provider !== "github" && (
                  <option value="production">{t("生产环境")}</option>
                )}
              </select>
            </label>
            {provider === "cloudflare" ? (
              <>
                <label>
                  Account ID
                  <input
                    name="accountId"
                    required
                    pattern="[a-fA-F0-9]{32}"
                    autoComplete="off"
                    placeholder={t("32 位账号 ID")}
                  />
                </label>
                <label>
                  API Token
                  <input
                    name="token"
                    type="password"
                    required
                    autoComplete="new-password"
                  />
                </label>
                <small className="muted">
                  {t("需要对应账号的 Cloudflare Pages 编辑权限。不会自动修改 DNS 区域。")}</small>
              </>
            ) : provider === "supabase" ? (
              <>
                <label>
                  Project URL
                  <input
                    name="url"
                    type="url"
                    required
                    placeholder="https://your-project.supabase.co"
                  />
                </label>
                <label>
                  Publishable / anon key
                  <input
                    name="key"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="sb_publishable_…"
                  />
                </label>
                <small className="muted">
                  {t("只接受公开客户端密钥。禁止 service_role 或 secret key。")}</small>
              </>
            ) : (
              <>
                <label>
                  {t("GitHub 仓库")}<input
                    name="repository"
                    required
                    placeholder="owner/repository"
                    pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
                  />
                </label>
                <label>
                  GitHub Token{" "}
                  <span className="optional">{t("私有仓库 / 产物下载需要")}</span>
                  <input
                    name="token"
                    type="password"
                    autoComplete="new-password"
                  />
                </label>
                <small className="muted">
                  {t("请选择仅限目标仓库的 Token。读取已有产物需要 Metadata / Actions 读取权限；启动构建还需 Actions 读写，首次安装流程还需 Contents / Workflows 读写。构建在你自己的 GitHub Actions 中执行，使用你的 Actions 额度。")}</small>
              </>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={closeModal} disabled={project?.role==='viewer'}
              >
                {t("取消")}</button>
              <button
                className="button primary"
                disabled={project?.role==='viewer'||(!!busy || !connectProjectId)}
              >
                <Plug size={15} />
                {t("验证并连接")}</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "domain" && project && (
        <Modal title={t("添加自定义域名")} onClose={closeModal} busy={!!busy}>
          <form
            className="modal-form"
            onSubmit={(e) => {
              const f = form(e);
              void run(
                t("登记域名"),
                async () => {
                  await api("/projects/" + project.id + "/domains", f);
                  setModal(null);
                },
                t("域名已登记，请继续检查连接和配置 DNS"),
              );
            }}
          >
            <label>{t("访问服务")}<select name="provider"><option value="pages">Cloudflare Pages</option><option value="gateway" disabled={!canHost(project.id)}>TapeNow Gateway · BSC / X Layer / Base</option><option value="hashport" disabled={project.chain.chainId!==56}>HashPort · BSC</option></select></label>
            <label>
              {t("域名")}<input
                name="hostname"
                placeholder="play.example.com"
                required
                autoComplete="off"
              />
            </label>
            <Notice>
              {t("登记后检查 DNS 变更并确认。Cloudflare Pages 需要生产部署；HashPort 需要 BSC 文件发布和钱包签署域名绑定。")}</Notice>
            <div className="modal-actions">
              <button className="button primary" disabled={project?.role==='viewer'||(!!busy)}>
                {t("添加域名")}<ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "env" && project && (
        <Modal title={t("保存环境配置")} onClose={closeModal} busy={!!busy}>
          <form
            className="modal-form"
            onSubmit={(e) => {
              const f = form(e);
              void run(
                t("保存环境配置"),
                async () => {
                  await api("/projects/" + project.id + "/environment", {
                    ...f,
                    secret: f.secret === "on",
                  });
                  setModal(null);
                },
                t("配置已保存；尚未注入任何构建"),
              );
            }}
          >
            <label>
              {t("变量名")}<input
                name="key"
                placeholder="PUBLIC_API_URL"
                pattern="[A-Z][A-Z0-9_]{1,63}"
                required
              />
            </label>
            <label>
              {t("值")}<textarea name="value" required maxLength={8000} />
            </label>
            <label>
              {t("环境")}<select name="environment">
                <option value="preview">Preview</option>
                <option value="production">Production</option>
              </select>
            </label>
            <label>{t("使用阶段")}<select name="stage"><option value="build">{t("构建期 · 修改后需导入新产物")}</option><option value="runtime">{t("运行期 · 修改后重新确认发布")}</option></select></label>
            <label className="checkbox-label">
              <input type="checkbox" name="secret" defaultChecked />
              {t("作为秘密加密保存")}</label>
            <Notice>
              {t("部署 Worker 时可使用这些变量。构建时的环境变量请在 GitHub 配置；静态网站无法保守秘密。")}</Notice>
            <div className="modal-actions">
              <button className="button primary" disabled={project?.role==='viewer'||(!!busy)}>
                {t("保存配置")}</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "help" && (
        <GuideCenter
          initialSection={guide.section}
          initialTopic={guide.topic}
          projects={data.projects}
          currentProject={project}
          onClose={closeModal}
          onAction={guideAction}
        />
      )}
      {confirm?.type === "restore" && <RestoreDialog release={confirm.r} onClose={closeConfirm} onRestored={async r=>{await refresh();openRelease(r);setConfirm(null);}}/>}
      {confirm && confirm.type !== "restore" && (
        <Modal
          title={
            t("设为当前版本？")
          }
          onClose={closeConfirm}
          busy={!!busy}
        >
          <div className="modal-form">
            <p>
              {t("目标版本：")}<strong>{confirm.r.label}</strong>
            </p>
            <Notice>
              {t("工作台项目首页将指向这个版本。独立预览地址仍然保留。 此操作不会自动修改 Cloudflare 或链上文件。")}</Notice>
            <div className="modal-actions">
              <button className="button secondary" onClick={closeConfirm}>
                {t("取消")}</button>
              <button
                className="button primary"
                disabled={project?.role==='viewer'||(!!busy)}
                onClick={() =>
                  void run(
                    t("更新当前版本"),
                    async () => {
                      const r = await api<Release>(
                        "/projects/" + confirm.r.projectId + "/" + confirm.type,
                        { releaseId: confirm.r.id },
                      );
                      setConfirm(null);
                      openRelease(r);
                    },
                    t("当前版本已更新"),
                  )
                }
              >
                {t("确认设置")}<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ImportModal({
  project,
  busy,
  onClose,
  onImport,
  onSample,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onImport: (f: File[], label: string) => Promise<unknown>;
  onSample: (v: number) => Promise<unknown>;
}) {
 useLanguage();
  const [files, setFiles] = useState<File[]>([]),
    [label, setLabel] = useState("");
  const folderRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      title={t("导入构建")}
      kicker={project.name.toUpperCase()}
      onClose={onClose}
      busy={busy}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onImport(files, label || t("新构建"));
        }}
      >
        <label>
          {t("版本名称")}<input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("例如：新的首页和留言板")}
            maxLength={100}
          />
        </label>
        <div
          className={"upload-zone " + (files.length ? "selected" : "")}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <span className="upload-icon">
            <Upload size={25} />
          </span>
          <strong>
            {files.length
              ? files.length +
                t(" 个文件 · ") +
                bytes(files.reduce((s, f) => s + f.size, 0))
              : t("把构建 ZIP 拖到这里")}
          </strong>
          <p>{t("根目录包含 index.html · 最大 10 MiB / 500 文件")}</p>
          <div className="button-row">
            <label className="button secondary file-picker">
              {t("选择 ZIP")}<input
                type="file"
                accept=".zip"
                aria-label={t("选择构建 ZIP")}
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => folderRef.current?.click()} disabled={project?.role==='viewer'}
            >
              <Folder size={14} />
              {t("选择构建目录")}</button>
            <input
              ref={folderRef}
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
              className="sr-only"
              aria-label={t("选择构建目录")}
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </div>
        </div>
        {files.length > 0 && (
          <div className="upload-file-list">
            {files.slice(0, 5).map((f, i) => (
              <span key={i}>
                <FileCode2 size={13} />
                {f.webkitRelativePath || f.name}
              </span>
            ))}
            {files.length > 5 && (
              <small>{t("以及另外")}{files.length - 5} {t("个文件")}</small>
            )}
          </div>
        )}
        <div className="sample-shortcut">
          <div>
            <strong>{t("还没准备好构建包？")}</strong>
            <span>{t("用独立的霓虹圣物展示页体验整个流程。")}</span>
          </div>
          <button
            type="button"
            className="text-button"
            disabled={project?.role==='viewer'||(busy)}
            onClick={() => void onSample(1)}
          >
            {t("示例 v1")}</button>
          <button
            type="button"
            className="text-button"
            disabled={project?.role==='viewer'||(busy)}
            onClick={() => void onSample(2)}
          >
            {t("示例 v2")}</button>
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={project?.role==='viewer'}>
            {t("取消")}</button>
          <button className="button primary" disabled={project?.role==='viewer'||(!files.length || busy)}>
            <Upload size={15} />
            {t("导入并预览")}</button>
        </div>
      </form>
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(<LanguageProvider><SessionBoundary><App /></SessionBoundary></LanguageProvider>);
