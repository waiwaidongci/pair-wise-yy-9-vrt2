// 接口路由层：只负责 HTTP 解析、参数校验和响应；业务规则交给 workflow，存取交给 store。

import {
  STEPS,
  STATUS_LABELS,
  STATUS_DELIVERED,
  WorkflowError,
  createWorkflow,
  currentStep,
  submitStep,
  deliver,
  syncStatus,
} from "./workflow.js";
import { listItems, findItem, addItem, persist } from "./store.js";
import { page } from "./view.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const FIELD_LABELS = {
  code: "底片编号",
  plateSize: "玻璃板尺寸",
  chemicalBatch: "药液批次",
  exposure: "曝光时间",
  waterSource: "冲洗水源",
  box: "存放盒位",
};

const FIELDS = Object.entries(FIELD_LABELS);

function toView(item) {
  syncStatus(item);
  const current = currentStep(item);
  const reworkCount = item.workflow.reduce(
    (total, step) => total + step.attempts.filter((attempt) => attempt.rework).length,
    0,
  );
  return { ...item, currentStepKey: current ? current.key : null, reworkCount };
}

function computeStats(items) {
  const stats = { 全部: items.length };
  for (const label of STATUS_LABELS) stats[label] = 0;
  for (const item of items) {
    if (stats[item.status] === undefined) stats[item.status] = 0;
    stats[item.status] += 1;
  }
  const reworking = items.filter((item) =>
    item.workflow.some((step) => step.status === "failed"),
  ).length;
  return { stats, reworking };
}

// WorkflowError.code -> HTTP 状态码
const ERROR_STATUS = {
  item_not_found: 404,
  unknown_step: 400,
  result_required: 400,
  reason_required: 400,
  code_required: 400,
  code_conflict: 409,
  not_current_step: 409,
  already_done: 409,
  not_deliverable: 409,
  already_delivered: 409,
};

export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/") {
    return html(
      res,
      page({ STEPS, STATUS_LABELS, FIELDS, STATUS_DELIVERED }),
    );
  }

  if (req.method === "GET" && pathname === "/api/items") {
    const items = await listItems();
    return send(res, 200, items.map(toView));
  }

  if (req.method === "GET" && pathname === "/api/stats") {
    return send(res, 200, computeStats(await listItems()));
  }

  // 建档：自动生成六个待执行项
  if (req.method === "POST" && pathname === "/api/items") {
    const input = await readBody(req);
    const code = String(input.code || "").trim();
    if (!code) throw new WorkflowError("code_required", "底片编号必填");

    const items = await listItems();
    if (items.some((item) => item.code === code)) {
      throw new WorkflowError("code_conflict", `底片编号 ${code} 已存在`);
    }

    const now = new Date().toISOString();
    const item = {
      id: code,
      code,
      plateSize: String(input.plateSize || "").trim(),
      chemicalBatch: String(input.chemicalBatch || "").trim(),
      exposure: String(input.exposure || "").trim(),
      waterSource: String(input.waterSource || "").trim(),
      box: String(input.box || "").trim(),
      createdAt: now,
      workflow: createWorkflow(),
      deliveredAt: null,
      logs: [{ at: now, step: "建档", note: "创建底片，生成六道标准工序" }],
    };
    syncStatus(item);
    await addItem(item);
    return send(res, 201, toView(item));
  }

  // 提交工序：/api/items/:id/workflow/:stepKey
  const workflowMatch = pathname.match(/^\/api\/items\/([^/]+)\/workflow\/([^/]+)$/);
  if (workflowMatch && req.method === "POST") {
    const item = await findItem(workflowMatch[1]);
    if (!item) throw new WorkflowError("item_not_found", "底片不存在");
    const input = await readBody(req);
    const { step } = submitStep(item, workflowMatch[2], input);
    item.logs ||= [];
    item.logs.push({
      at: step.attempts[step.attempts.length - 1].at,
      step: step.name,
      note:
        input.result === "fail"
          ? `失败：${input.note}`
          : `${step.attempts[step.attempts.length - 1].rework ? "返工" : ""}通过${input.note ? `：${input.note}` : ""}`,
    });
    await persist();
    return send(res, 201, toView(item));
  }

  // 交付
  const deliverMatch = pathname.match(/^\/api\/items\/([^/]+)\/deliver$/);
  if (deliverMatch && req.method === "POST") {
    const item = await findItem(deliverMatch[1]);
    if (!item) throw new WorkflowError("item_not_found", "底片不存在");
    deliver(item);
    item.logs ||= [];
    item.logs.push({ at: item.deliveredAt, step: "交付", note: "底片交付，流程结束" });
    await persist();
    return send(res, 200, toView(item));
  }

  send(res, 404, { error: "not_found", message: "接口不存在" });
}

export function handleError(res, error) {
  if (error instanceof WorkflowError) {
    return send(res, ERROR_STATUS[error.code] || 400, {
      error: error.code,
      message: error.message,
    });
  }
  send(res, 500, { error: "internal_error", message: error.message });
}
