// 页面：底片列表、六道工序进度、当前步提交、失败原因与返工记录。
const fields = [["code","底片编号"],["plateSize","玻璃板尺寸"],["chemicalBatch","药液批次"],["exposure","曝光时间"],["waterSource","冲洗水源"],["box","存放盒位"]];
const statLabels = ["进行中","返工中","待交付","已交付"];

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:360px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.danger { background:var(--warn); }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.warn { color:var(--warn); border-color:var(--warn); font-weight:700; }
    .steps { list-style:none; margin:0; padding:0; display:grid; gap:6px; }
    .steps li { border:1px solid var(--line); border-radius:6px; padding:8px 10px; }
    .steps li.done { background:#eef3ea; } .steps li.current { border-color:var(--accent); } .steps li.failed { border-color:var(--warn); background:#f9efec; }
    .steps .head { display:flex; justify-content:space-between; gap:8px; align-items:center; }
    .warn { color:var(--warn); font-weight:700; }
    .records { margin-top:6px; display:grid; gap:2px; }
    .actions { display:grid; gap:8px; border-top:1px dashed var(--line); padding-top:8px; }
    .actions .row { display:flex; gap:8px; } .actions .row button { flex:1; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法蓝晒底片整理室</h1><div class="meta">标准工序：涂布 → 晾干 → 曝光 → 冲洗 → 复晒 → 入盒 → 交付</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增底片</h2><div id="fields"></div><div class="meta" style="margin:10px 0">建档后自动生成六道待执行工序，从「涂布」开始逐步提交。</div><button>保存底片</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${statLabels.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>底片与工序进度</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = ${JSON.stringify(fields)};
    const statLabels = ${JSON.stringify(statLabels)};
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'" '+(key==='code'?'required':'')+'>').join('');
    }
    function stepClass(s, current) {
      if (s.status === '已完成') return 'done';
      if (s.status === '失败待返工') return 'failed';
      if (s === current) return 'current';
      return '';
    }
    function stepHtml(s, current) {
      const records = (s.records || []).map(r =>
        '<div>'+esc((r.at||'').slice(0,10))+' · '+esc(r.type)+'·'+esc(r.result)
        +(r.reason ? ' · 原因：'+esc(r.reason) : '')+(r.note ? ' · '+esc(r.note) : '')+'</div>').join('');
      return '<li class="'+stepClass(s, current)+'"><div class="head"><b>'+esc(s.name)+'</b><span class="pill'+(s.status==='失败待返工'?' warn':'')+'">'+esc(s.status)+'</span></div>'
        +(s.failureReason ? '<div class="warn meta">失败原因：'+esc(s.failureReason)+'</div>' : '')
        +(records ? '<div class="records meta">'+records+'</div>' : '')+'</li>';
    }
    function cardHtml(item) {
      const current = (item.workflow || []).find(s => s.status === '待提交' || s.status === '失败待返工');
      const main = fields.slice(1).map(([key,label]) => '<div><b>'+label+'</b> '+esc(item[key])+'</div>').join('');
      const steps = (item.workflow || []).map(s => stepHtml(s, current)).join('');
      const id = encodeURIComponent(item.id || item.code);
      let actions = '';
      if (item.status === '待交付') {
        actions = '<div class="actions"><button data-deliver="'+id+'">确认交付</button></div>';
      } else if (current) {
        const failed = current.status === '失败待返工';
        actions = '<div class="actions" data-step="'+esc(current.name)+'" data-id="'+id+'">'
          + '<div class="meta">当前工序：'+esc(current.name)+(failed ? '（返工）' : '')+'</div>'
          + '<input name="note" placeholder="备注（可选）"><input name="reason" placeholder="失败原因（记录失败时必填）">'
          + '<div class="row"><button data-pass>'+(failed ? '返工通过' : '提交通过')+'</button>'
          + '<button class="danger" data-fail>'+(failed ? '返工仍失败' : '记录失败')+'</button></div></div>';
      }
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+esc((l.at||'').slice(0,10))+' '+esc(l.step)+'：'+esc(l.note)+'</div>').join('');
      return '<article class="card"><h3>'+esc(item.code || item.id)+' <span class="pill">'+esc(item.status)+'</span></h3>'
        + '<div class="meta">当前进度：'+(current ? esc(current.name) : (item.delivered ? '已交付' : '待交付'))+'</div>'
        + main + '<ol class="steps">'+steps+'</ol>' + actions
        + '<button class="secondary" data-note="'+id+'">追加备注</button>'
        + '<div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    function render() {
      const stats = Object.fromEntries(statLabels.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(cardHtml).join('') || '<div class="meta">暂无底片</div>';
      document.querySelectorAll('[data-deliver]').forEach(btn => btn.onclick = () => run(api('/api/items/'+btn.dataset.deliver+'/deliver', { method:'POST' })));
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => {
        const note = prompt('记录备注');
        if (note) run(api('/api/items/'+btn.dataset.note+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }));
      });
      document.querySelectorAll('.actions[data-step]').forEach(box => {
        const submit = result => {
          const note = box.querySelector('[name=note]').value.trim();
          const reason = box.querySelector('[name=reason]').value.trim();
          if (result === 'fail' && !reason) { alert('记录失败时必须填写失败原因'); return; }
          run(api('/api/items/'+box.dataset.id+'/steps/'+encodeURIComponent(box.dataset.step)+'/submit',
            { method:'POST', body: JSON.stringify({ result, reason, note }) }));
        };
        box.querySelector('[data-pass]').onclick = () => submit('pass');
        box.querySelector('[data-fail]').onclick = () => submit('fail');
      });
    }
    async function run(p) { try { await p; await load(); } catch (e) { alert(e.message); } }
    async function load() { items = await api('/api/items'); render(); }
    document.querySelector('#createForm').onsubmit = event => {
      event.preventDefault();
      run(api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) })
        .then(() => event.target.reset()));
    };
    document.querySelector('#statusFilter').onchange = render;
    document.querySelector('#search').oninput = render;
    document.querySelector('#reload').onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}
