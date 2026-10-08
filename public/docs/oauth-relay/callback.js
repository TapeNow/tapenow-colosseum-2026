// Local development only. No token exchange, analytics, storage, or arbitrary redirects.
(() => {
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", location.pathname);
  const state = params.get("state"),
    code = params.get("code"),
    error = params.get("error");
  const message = document.getElementById("status");
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    params.getAll("state").length !== 1 ||
    (!code && !error) ||
    (code && (code.length > 4096 || params.getAll("code").length !== 1))
  ) {
    message.textContent =
      "请从本机 http://127.0.0.1:4311 发起授权。此页面不提供工作台访问。";
    return;
  }
  const target = new URL("http://127.0.0.1:4311/api/oauth/supabase/callback");
  target.searchParams.set("state", state);
  if (error) target.searchParams.set("error", "access_denied");
  else target.searchParams.set("code", code);
  message.textContent = "正在返回本地工作台。请保持本机服务运行。";
  location.replace(target.href);
})();
