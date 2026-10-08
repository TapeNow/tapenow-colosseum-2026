import { t, useLanguage, statusLabel } from "./i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Release } from "./types";
import { isCloud } from "./api";
import {
  X,
  ArrowUpRight,
  Check,
  Loader2,
  AlertCircle,
} from "lucide-react";

export function Brand({ small = false, tone = "light" }: { small?: boolean; tone?: "light" | "dark" }) {
 useLanguage();
  return (
    <span className={"brand " + (small ? "small" : "")}>
      <img src={"/brand/v2/" + (small ? "mark-" : "lockup-") + tone + ".svg"}
        alt="TapeNow" width={small ? 96 : 354} height="96" />
    </span>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
 useLanguage();
  return (
    <span className={"badge " + tone}>
      <span className="status-dot" />
      {typeof children==='string'?statusLabel(children):children}
    </span>
  );
}
export function ReleaseStatus({
  r,
  current = false,
}: {
  r: Release;
  current?: boolean;
}) {
 useLanguage();
  if(r.archive?.state&&r.archive.state!=='available')return <Badge>{{trash:t("回收站"),purging:t("正在清除"),purged:t("文件已清除")}[r.archive.state]||r.archive.state}</Badge>;
  if(r.privatePreview?.status==='active'&&Date.parse(r.privatePreview.expiresAt)>Date.now())return <Badge tone="teal">{t("密码预览")}</Badge>;
  if(r.workflow)return <Badge tone={r.workflow.status==='complete'?'teal':r.workflow.status==='pending'?'amber':'neutral'}>{{complete:r.restoredFrom?t("恢复已发布"):t("发布完成"),pending:t("待恢复交易"),in_progress:t("发布进行中"),ready:t("已确认 · 待发布"),needs_approval:t("待确认发布")}[r.workflow.status]||t("待处理")}</Badge>;
  return (
    <Badge
      tone={
        r.chainStatus === "verified" ? "green" : current ? "teal" : "neutral"
      }
    >
      {r.chainStatus === "verified"
        ? t("链上已核验")
        : current
          ? (isCloud() ? t("当前版本") : t("本地当前版本"))
          : (isCloud() && !r.preview?.url ? t("预览待生成") : t("预览就绪"))}
    </Badge>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
  illustration,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  illustration?: "project";
}) {
 useLanguage();
  return (
    <div className="empty">
      {illustration === "project" ? <img className="empty-art" src="/brand/v2/empty-project.svg" width="192" height="144" alt="" aria-hidden="true" /> : <span className="empty-icon">{icon}</span>}
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function External({
  href,
  children,
  className = "button secondary",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
 useLanguage();
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
export function Modal({
  title,
  kicker,
  children,
  onClose,
  wide = false,
  busy = false,
  className = "",
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
 useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]",
        ) || [],
      ).filter(
        (item) => item.tabIndex >= 0 && item.getClientRects().length > 0,
      );
    focusable()[0]?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        const all = focusable().filter((x) => x.offsetParent !== null);
        if (!all.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [busy, onClose]);
  // Rendered on <body> so a dialog opened from the sticky top bar is not clipped,
  // stacked under page content, or styled by the bar's nowrap/small-type rules.
  const dialog = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={"modal " + (wide ? "wide " : "") + className}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            {kicker && <span className="eyebrow">{kicker}</span>}
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label={t("关闭对话框")}
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: string;
}) {
 useLanguage();
  return (
    <div className={"notice " + tone}>
      <AlertCircle size={16} />
      <div>{children}</div>
    </div>
  );
}
export function ResultIcon({ status }: { status: string }) {
 useLanguage();
  return status === "passed" ? <Check size={16} /> : <Loader2 size={16} />;
}

/** Live previews stay isolated on the dedicated preview origin. */
export function WebsitePreview({
  href,
  title,
  label,
  locked=false,
  unpublished=false,
}: {
  locked?:boolean;
  unpublished?:boolean;
  href: string;
  title: string;
  label: string;
}) {
 useLanguage();
  const [loadedHref, setLoadedHref] = useState<string | null>(null);
  const loaded = loadedHref === href;
  if(unpublished)return <div className="preview-frame"><span className="preview-loading">{t("仅归档 · 请先创建预览")}</span></div>;
  return (
    <a
      className="preview-frame"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      data-loaded={loaded}
    >
      {!locked && <iframe
        key={href}
        src={href}
        title={title}
        loading="lazy"
        tabIndex={-1}
        sandbox="allow-scripts allow-same-origin"
        onLoad={() => setLoadedHref(href)}
      />}
      {locked&&<span className="preview-loading">{t("密码保护 · 在新窗口输入密码")}</span>}
      {!locked&&!loaded && (
        <span className="preview-loading">
          <Loader2 className="spin" size={17} />
          {t("正在加载预览…")}</span>
      )}
      <span className="preview-overlay">
        <ArrowUpRight size={20} />
        {t("打开预览")}</span>
    </a>
  );
}
