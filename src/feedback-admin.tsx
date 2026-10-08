import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { api, getSession } from "./api";
import { t, useLanguage, localeDate, translateMessage } from "./i18n";
import { Badge, Notice } from "./ui";
import "./feedback-admin.css";

type Status = "new" | "read" | "done";
type Category = "bug" | "idea" | "other";
type Item = {
  id: number;
  category: Category;
  status: Status;
  message: string;
  createdAt: string;
  context: {
    page?: string;
    language?: string;
    version?: string;
    touch?: boolean;
    userAgent?: string;
    lastError?: string;
    viewport?: { width?: number; height?: number };
  };
  reporter: { id: string; email: string | null; wallet: string | null; missing?: boolean };
};
type Page = { items: Item[]; next: number | null; counts: Record<Status, number> };

const statusLabel = (s: Status) => (s === "new" ? t("未处理") : s === "read" ? t("已查看") : t("已完成"));
const categoryLabel = (c: Category) => (c === "bug" ? t("遇到问题") : c === "idea" ? t("功能建议") : t("其他"));
const shortWallet = (w: string) => w.slice(0, 6) + "…" + w.slice(-4);

// A short, readable browser name from the user agent; the full string stays in the details.
function browser(ua = "") {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const name = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [name, os].filter(Boolean).join(" · ") || t("未知浏览器");
}

export function FeedbackAdminPage() {
  useLanguage();
  const [status, setStatus] = useState<Status | "">("new");
  const [category, setCategory] = useState<Category | "">("");
  const [data, setData] = useState<Page | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");

  async function load(more = false) {
    setBusy(more ? "more" : "load");
    setError("");
    try {
      const q = new URLSearchParams();
      if (status) q.set("status", status);
      if (category) q.set("category", category);
      if (more && data?.next) q.set("before", String(data.next));
      const page = await api<Page>("/admin/feedback?" + q);
      setData(more && data ? { ...page, items: [...data.items, ...page.items] } : page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (getSession().operator) void load();
  }, [status, category]);

  async function mark(item: Item, next: Status) {
    setBusy("item-" + item.id);
    setError("");
    try {
      await api("/admin/feedback/status", { id: item.id, status: next });
      setData((d) => {
        if (!d) return d;
        const counts = { ...d.counts, [item.status]: d.counts[item.status] - 1, [next]: d.counts[next] + 1 };
        // Leave the filtered view consistent: an item that no longer matches drops out.
        const items = status && status !== next ? d.items.filter((i) => i.id !== item.id) : d.items.map((i) => (i.id === item.id ? { ...i, status: next } : i));
        return { ...d, items, counts };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!getSession().operator) return <Notice>{t("只有平台维护者可以查看用户反馈。")}</Notice>;
  const counts = data?.counts || { new: 0, read: 0, done: 0 };
  const total = counts.new + counts.read + counts.done;
  return (
    <div className="batch-page feedback-admin">
      <div className="page-heading">
        <div>
          <h1>{t("用户反馈")}</h1>
          <p>{t("公测用户从工作台提交的问题和建议。只有平台维护者可以看到。")}</p>
        </div>
        <button className="button secondary" disabled={!!busy} onClick={() => void load()}>
          {busy === "load" ? t("正在读取…") : t("刷新")}
        </button>
      </div>

      <div className="feedback-filters" role="group" aria-label={t("按状态筛选")}>
        {([["new", counts.new], ["read", counts.read], ["done", counts.done], ["", total]] as [Status | "", number][]).map(([value, n]) => (
          <button key={value || "all"} className={"feedback-tab" + (status === value ? " active" : "")} aria-pressed={status === value} onClick={() => setStatus(value)}>
            {value ? statusLabel(value) : t("全部")}
            <span>{n}</span>
          </button>
        ))}
        <label className="feedback-category">
          {t("类型")}
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
            <option value="">{t("全部类型")}</option>
            <option value="bug">{categoryLabel("bug")}</option>
            <option value="idea">{categoryLabel("idea")}</option>
            <option value="other">{categoryLabel("other")}</option>
          </select>
        </label>
      </div>

      {error && <p className="batch-feedback error" role="alert">{translateMessage(error)}</p>}

      <section className="panel">
        <div className="batch-list">
          {!data && !error && <p className="muted feedback-empty">{t("正在读取…")}</p>}
          {data && !data.items.length && (
            <div className="feedback-empty">
              <MessageSquareText size={22} aria-hidden="true" />
              <p className="muted">{status === "new" ? t("没有未处理的反馈。") : t("没有符合条件的反馈。")}</p>
            </div>
          )}
          {data?.items.map((item) => {
            const c = item.context || {};
            const who = item.reporter.email || (item.reporter.wallet ? shortWallet(item.reporter.wallet) : item.reporter.missing ? t("账号已删除") : t("未知用户"));
            return (
              <article className="feedback-item" key={item.id}>
                <header>
                  <Badge tone={item.category === "bug" ? "warning" : item.category === "idea" ? "teal" : "neutral"}>{categoryLabel(item.category)}</Badge>
                  <strong title={item.reporter.wallet || item.reporter.email || item.reporter.id}>{who}</strong>
                  <span className="muted">
                    #{item.id} · {localeDate(item.createdAt, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Badge tone={item.status === "done" ? "teal" : item.status === "new" ? "dark" : "neutral"}>{statusLabel(item.status)}</Badge>
                </header>
                {/* User-written text is shown exactly as submitted and never translated. */}
                <p className="feedback-message">{item.message}</p>
                <dl className="feedback-meta">
                  <div><dt>{t("页面")}</dt><dd><code>{c.page || "/"}</code></dd></div>
                  <div><dt>{t("设备")}</dt><dd>{browser(c.userAgent)}{c.touch ? " · " + t("触屏") : ""}{c.viewport?.width ? ` · ${c.viewport.width}×${c.viewport.height}` : ""}</dd></div>
                  <div><dt>{t("界面语言")}</dt><dd>{c.language || "—"}</dd></div>
                  <div><dt>{t("应用版本")}</dt><dd>{c.version || "—"}</dd></div>
                  {c.lastError && <div className="wide"><dt>{t("最近的错误提示")}</dt><dd>{c.lastError}</dd></div>}
                </dl>
                <details>
                  <summary>{t("完整信息")}</summary>
                  <p className="feedback-ua"><code>{c.userAgent || "—"}</code></p>
                  <p className="feedback-ua"><code>{item.reporter.wallet || item.reporter.email || "—"} · {item.reporter.id}</code></p>
                </details>
                <div className="button-row">
                  {item.status !== "read" && item.status !== "done" && (
                    <button className="button secondary" disabled={!!busy} onClick={() => void mark(item, "read")}>{t("标为已查看")}</button>
                  )}
                  {item.status !== "done" ? (
                    <button className="button primary" disabled={!!busy} onClick={() => void mark(item, "done")}>{t("标为已完成")}</button>
                  ) : (
                    <button className="button secondary" disabled={!!busy} onClick={() => void mark(item, "new")}>{t("重新打开")}</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {data?.next && (
        <button className="button secondary feedback-more" disabled={!!busy} onClick={() => void load(true)}>
          {busy === "more" ? t("正在读取…") : t("加载更早的反馈")}
        </button>
      )}
    </div>
  );
}
