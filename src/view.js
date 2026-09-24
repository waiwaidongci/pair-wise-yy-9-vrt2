// 页面渲染层：返回操作室的 HTML。服务端注入工序常量，客户端只用字符串拼接，
// 避免在模板字符串里再嵌套模板。

export function page(config) {
  const CONFIG_JSON = JSON.stringify(config).replace(/</g, "\\u003c");
  const STATUS_JSON = JSON.stringify(config.STATUS_LABELS).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --ok:#3d6b4a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.fail { background:var(--warn); } button:disabled { background:#aab3a5; cursor:not-allowed; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; } .stat.rework strong { color:var(--warn); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar input { width:auto; min-width:200px; flex:1; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; } .card { display:grid; gap:10px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:12px; } .pill.done { background:#e7f0e4; color:var(--ok); border-color:#c4d8bf; } .pill.fail { background:#f6e5e0; color:var(--warn); border-color:#e3bdb2; }
    .steps { display:grid; gap:6px; }
    .step { display:flex; align-items:flex-start; gap:8px; border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-size:13px; }
    .step.done { background:#f4f8f2; } .step.failed { border-color:var(--warn); background:#fbf1ee; } .step.pending { color:var(--muted); }
    .step.current { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
    .step .name { font-weight:700; min-width:44px; }
    .step .body { flex:1; display:grid; gap:4px; }
    .step .tag { font-size:11px; border-radius:4px; padding:1px 6px; background:#e4e9e1; color:var(--muted); white-space:nowrap; }
    .step .tag.rework { background:#efe6d8; color:#8a5a25; }
    .step .reason { color:var(--warn); }
    .step .attempt { color:var(--muted); font-size:12px; }
    .step .actions { display:flex; gap:6px; margin-top:4px; }
    .step .actions button { padding:6px 10px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:110px; overflow:auto; display:grid; gap:2px; }
    .alert { color:var(--warn); font-weight:700; min-height:18px; font-size:13px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>古法蓝晒底片整理室</h1><div class="meta">建档自动生成六道标准工序：涂布 → 晾干 → 曝光 → 冲洗 → 复晒 → 入盒，按序提交、失败返工、入盒交付</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <section>
      <form id="createForm">
        <h2>新建底片建档</h2>
        <div id="fields"></div>
        <div class="meta" style="margin-top:8px">保存后自动生成六个待执行项，从「涂布」开始按顺序执行。</div>
        <div style="margin-top:10px"><button>保存底片</button></div>
        <div class="alert" id="createAlert"></div>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <input id="search" placeholder="搜索编号、盒位、药液批次等">
      </div>
      <div class="panel">
        <div class="grid" id="cards"></div>
      </div>
    </section>
  </main>
  <script>
    const CONFIG = JSON.parse("${CONFIG_JSON}");
    const STATUS_LABELS = JSON.parse("${STATUS_JSON}");
    const cardsEl = document.getElementById("cards");
    const statsEl = document.getElementById("stats");
    const filterEl = document.getElementById("statusFilter");
    const searchEl = document.getElementById("search");
    const createForm = document.getElementById("createForm");
    const createAlert = document.getElementById("createAlert");
    let items = [];

    async function api(path, options) {
      const opts = options || {};
      if (opts.body) opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "请求失败");
      return data;
    }

    function esc(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
        return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch];
      });
    }

    function fmtTime(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return esc(iso);
      const pad = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function resultLabel(result) { return result === "pass" ? "通过" : "失败"; }

    function renderForms() {
      document.getElementById("fields").innerHTML = CONFIG.FIELDS.map(function (entry) {
        const key = entry[0], label = entry[1];
        return '<label>' + label + (key === "code" ? "（必填）" : "") + '</label><input name="' + key + '"' + (key === "code" ? " required" : "") + '>';
      }).join("");
      filterEl.innerHTML = '<option value="">全部状态</option>' + STATUS_LABELS.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join("");
    }

    function renderStats(data) {
      const entries = [["全部", data.stats["全部"]]]
        .concat(STATUS_LABELS.map(function (s) { return [s, data.stats[s] || 0]; }));
      let html = entries.map(function (entry) {
        return '<div class="stat"><span>' + esc(entry[0]) + '</span><strong>' + entry[1] + '</strong></div>';
      }).join("");
      html += '<div class="stat rework"><span>返工中</span><strong>' + data.reworking + '</strong></div>';
      statsEl.innerHTML = html;
    }

    function stepHtml(item, step) {
      const isCurrent = item.currentStepKey === step.key && !item.deliveredAt;
      const cls = ["step", step.status, isCurrent ? "current" : ""].join(" ");
      const tag =
        step.status === "done" ? '<span class="tag">已通过</span>' :
        step.status === "failed" ? '<span class="pill fail">失败待返工</span>' :
        isCurrent ? '<span class="tag">当前工序</span>' : '<span class="tag">待执行</span>';
      const attempts = (step.attempts || []).map(function (attempt, index) {
        const reworkTag = attempt.rework ? '<span class="tag rework">返工第' + index + '次</span>' : (index > 0 ? '<span class="tag rework">第' + (index + 1) + '次提交</span>' : "");
        return '<div class="attempt">' + fmtTime(attempt.at) + " " + resultLabel(attempt.result) + " " + reworkTag +
          (attempt.note ? "：" + esc(attempt.note) : "") + "</div>";
      }).join("");
      const failReason = step.status === "failed" && step.failReason
        ? '<div class="reason">失败原因：' + esc(step.failReason) + "</div>" : "";
      const actions = isCurrent
        ? '<div class="actions">'
          + '<button data-id="' + esc(item.id) + '" data-step="' + esc(step.key) + '" data-result="pass">提交通过</button>'
          + '<button class="fail" data-id="' + esc(item.id) + '" data-step="' + esc(step.key) + '" data-result="fail">记录失败</button>'
          + "</div>"
        : "";
      return '<div class="' + cls + '"><span class="name">' + esc(step.name) + '</span><div class="body">'
        + '<div>' + tag + '</div>' + failReason + attempts + actions + '</div></div>';
    }

    function cardHtml(item) {
      const meta = CONFIG.FIELDS.slice(1).map(function (entry) {
        return item[entry[0]] ? '<span class="meta">' + esc(entry[1]) + "：" + esc(item[entry[0]]) + "</span>" : "";
      }).filter(Boolean).join(" · ");
      const steps = (item.workflow || []).map(function (step) { return stepHtml(item, step); }).join("");
      const logs = (item.logs || []).slice(-5).map(function (log) {
        return '<div class="meta">' + fmtTime(log.at) + " " + esc(log.step) + "：" + esc(log.note) + "</div>";
      }).join("");
      const statusPill = item.status === "已交付"
        ? '<span class="pill done">' + esc(item.status) + "</span>"
        : '<span class="pill">' + esc(item.status) + "</span>";
      const deliver = (!item.deliveredAt && item.currentStepKey === null)
        ? '<button data-id="' + esc(item.id) + '" data-deliver="1">确认交付（流程结束）</button>' : "";
      return '<article class="card">'
        + "<h3>" + esc(item.code) + " " + statusPill + "</h3>"
        + (meta ? "<div>" + meta + "</div>" : "")
        + (item.reworkCount ? '<div class="meta">累计返工提交：' + item.reworkCount + " 次</div>" : "")
        + '<div class="steps">' + steps + "</div>"
        + deliver
        + '<div class="logs">' + (logs || '<span class="meta">暂无记录</span>') + "</div>"
        + '<div class="alert" data-alert="' + esc(item.id) + '"></div>'
        + "</article>";
    }

    function renderCards() {
      const status = filterEl.value;
      const q = searchEl.value.trim();
      const visible = items.filter(function (item) {
        if (status && item.status !== status) return false;
        if (q) return JSON.stringify(item).indexOf(q) >= 0;
        return true;
      });
      cardsEl.innerHTML = visible.length
        ? visible.map(cardHtml).join("")
        : '<div class="meta">没有符合条件的底片</div>';
    }

    async function load() {
      const [list, stats] = await Promise.all([api("/api/items"), api("/api/stats")]);
      items = list;
      renderStats(stats);
      renderCards();
    }

    function cardAlert(id, message) {
      const el = document.querySelector('[data-alert="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (el) { el.textContent = message; setTimeout(function () { el.textContent = ""; }, 4000); }
    }

    cardsEl.addEventListener("click", async function (event) {
      const btn = event.target.closest("button");
      if (!btn) return;
      const id = btn.dataset.id;
      try {
        if (btn.dataset.deliver) {
          await api("/api/items/" + encodeURIComponent(id) + "/deliver", { method: "POST", body: "{}" });
        } else {
          let note = "";
          if (btn.dataset.result === "fail") {
            note = prompt("记录「" + (btn.closest(".step").querySelector(".name").textContent) + "」失败原因（必填，停在本步等待返工）");
            if (!note || !note.trim()) return;
          } else {
            note = prompt("「" + (btn.closest(".step").querySelector(".name").textContent) + "」通过备注（可留空）", "") || "";
          }
          await api("/api/items/" + encodeURIComponent(id) + "/workflow/" + encodeURIComponent(btn.dataset.step), {
            method: "POST",
            body: JSON.stringify({ result: btn.dataset.result, note: note.trim() }),
          });
        }
        await load();
      } catch (error) {
        cardAlert(id, error.message);
      }
    });

    createForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      createAlert.textContent = "";
      const data = Object.fromEntries(new FormData(createForm).entries());
      try {
        await api("/api/items", { method: "POST", body: JSON.stringify(data) });
        createForm.reset();
        await load();
      } catch (error) {
        createAlert.textContent = error.message;
      }
    });

    filterEl.addEventListener("change", renderCards);
    searchEl.addEventListener("input", renderCards);
    document.getElementById("reload").addEventListener("click", load);

    renderForms();
    load();
  </script>
</body>
</html>`;
}
