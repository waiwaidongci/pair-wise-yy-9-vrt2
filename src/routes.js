// 接口路由：底片建档、工序提交、交付、备注和统计。
import { loadDb, saveDb, findItem, newId } from "./store.js";
import { createWorkflow, submitStep, deliver, deriveStatus, summarize, STEPS } from "./workflow.js";

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export const statLabels = ["进行中", "返工中", "待交付", "已交付"];

function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    const status = deriveStatus(item);
    if (stats[status] !== undefined) stats[status] += 1;
  }
  return stats;
}

// 返回 true 表示请求已被处理
export async function handleApi(req, res, url) {
  const db = await loadDb();

  if (req.method === "GET" && url.pathname === "/api/items") {
    send(res, 200, db.items.map(summarize));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    send(res, 200, computeStats(db.items));
    return true;
  }

  // 建档：自动生成六道待执行工序
  if (req.method === "POST" && url.pathname === "/api/items") {
    const input = await body(req);
    if (!input.code || !String(input.code).trim()) {
      send(res, 400, { error: "底片编号必填" });
      return true;
    }
    const item = {
      id: newId(),
      code: String(input.code).trim(),
      plateSize: input.plateSize || "",
      chemicalBatch: input.chemicalBatch || "",
      exposure: input.exposure || "",
      waterSource: input.waterSource || "",
      box: input.box || "",
      delivered: false,
      workflow: createWorkflow(),
      logs: [{ at: new Date().toISOString(), step: "建档", note: `创建底片，生成工序：${STEPS.join("、")}` }],
    };
    item.status = deriveStatus(item);
    db.items.unshift(item);
    await saveDb(db);
    send(res, 201, summarize(item));
    return true;
  }

  // 提交当前工序：POST /api/items/:id/steps/:step/submit { result, reason?, note? }
  const submit = url.pathname.match(/^\/api\/items\/([^/]+)\/steps\/([^/]+)\/submit$/);
  if (submit && req.method === "POST") {
    const item = findItem(db, decodeURIComponent(submit[1]));
    if (!item) { send(res, 404, { error: "item_not_found" }); return true; }
    const result = submitStep(item, decodeURIComponent(submit[2]), await body(req));
    if (result.error) { send(res, result.status || 400, { error: result.error }); return true; }
    await saveDb(db);
    send(res, 200, summarize(item));
    return true;
  }

  // 交付：POST /api/items/:id/deliver
  const ship = url.pathname.match(/^\/api\/items\/([^/]+)\/deliver$/);
  if (ship && req.method === "POST") {
    const item = findItem(db, decodeURIComponent(ship[1]));
    if (!item) { send(res, 404, { error: "item_not_found" }); return true; }
    const result = deliver(item);
    if (result.error) { send(res, result.status || 400, { error: result.error }); return true; }
    await saveDb(db);
    send(res, 200, summarize(item));
    return true;
  }

  // 随手备注：POST /api/items/:id/logs { note }
  const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
  if (log && req.method === "POST") {
    const item = findItem(db, decodeURIComponent(log[1]));
    if (!item) { send(res, 404, { error: "item_not_found" }); return true; }
    const input = await body(req);
    item.logs ||= [];
    item.logs.push({ at: new Date().toISOString(), step: input.step || "备注", note: input.note || "" });
    await saveDb(db);
    send(res, 201, summarize(item));
    return true;
  }

  return false;
}
