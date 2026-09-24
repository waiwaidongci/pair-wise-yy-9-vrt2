// 工序规则层：标准工序定义、顺序提交、失败返工、状态派生、旧档补录。
// 不接触 HTTP 和文件，只对底片对象做纯业务操作。

export const STEPS = [
  { key: "coating", name: "涂布" },
  { key: "drying", name: "晾干" },
  { key: "exposure", name: "曝光" },
  { key: "washing", name: "冲洗" },
  { key: "reexposure", name: "复晒" },
  { key: "boxing", name: "入盒" },
];

export const STATUS_PENDING_DELIVERY = "待交付";
export const STATUS_DELIVERED = "已交付";
export const STATUS_LABELS = [
  ...STEPS.map((step) => `待${step.name}`),
  STATUS_PENDING_DELIVERY,
  STATUS_DELIVERED,
];

export class WorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

// 建档时调用：生成六个待执行项
export function createWorkflow() {
  return STEPS.map((step, order) => ({
    key: step.key,
    name: step.name,
    order,
    status: "pending", // pending 待执行 | failed 失败待返工 | done 已通过
    failReason: null, // 最近一次失败原因
    attempts: [], // 每次提交（含返工）都留痕
    completedAt: null,
  }));
}

// 当前轮到的工序：第一个未通过的步骤；全部通过返回 null
export function currentStep(item) {
  return (item.workflow || []).find((step) => step.status !== "done") || null;
}

export function isComplete(item) {
  return (
    Array.isArray(item.workflow) &&
    item.workflow.length === STEPS.length &&
    item.workflow.every((step) => step.status === "done")
  );
}

// 底片状态完全由工序进度派生，不允许手工指定
export function deriveStatus(item) {
  if (item.deliveredAt) return STATUS_DELIVERED;
  const current = currentStep(item);
  return current ? `待${current.name}` : STATUS_PENDING_DELIVERY;
}

export function syncStatus(item) {
  item.status = deriveStatus(item);
  return item.status;
}

// 提交当前工序：result = pass 通过 / fail 失败
export function submitStep(item, stepKey, input = {}) {
  if (item.deliveredAt) {
    throw new WorkflowError("already_delivered", "底片已交付，工序已结束");
  }
  if (!Array.isArray(item.workflow)) item.workflow = createWorkflow();

  const index = STEPS.findIndex((step) => step.key === stepKey || step.name === stepKey);
  if (index < 0) throw new WorkflowError("unknown_step", `未知工序：${stepKey}`);
  const step = item.workflow[index];

  if (step.status === "done") {
    throw new WorkflowError("already_done", `「${step.name}」已完成，不能重复提交`);
  }

  // 每次只轮到一步：只有当前工序可以提交，后面的步骤不能越过它完成
  const current = currentStep(item);
  if (!current || current.key !== step.key) {
    throw new WorkflowError(
      "not_current_step",
      `必须按顺序执行，请先完成「${current ? current.name : step.name}」`,
    );
  }

  const result = input.result === "pass" || input.result === "fail" ? input.result : null;
  if (!result) throw new WorkflowError("result_required", "请提交通过或失败");

  const note = String(input.note || "").trim();
  // 失败必须写原因，且停在原处等待返工
  if (result === "fail" && !note) {
    throw new WorkflowError("reason_required", "失败必须填写原因");
  }

  const attempt = {
    at: nowIso(),
    result,
    rework: step.attempts.length > 0, // 首次之后的提交都是返工
    note,
  };
  step.attempts.push(attempt);

  if (result === "fail") {
    step.status = "failed";
    step.failReason = note; // 停在原处，等待返工
  } else {
    step.status = "done";
    step.completedAt = attempt.at;
    step.failReason = null; // 返工通过，失败原因留在 attempts 历史里
  }

  syncStatus(item);
  return { step, attempt };
}

// 入盒（六道全部通过）后才能交付，交付后结束
export function deliver(item) {
  if (item.deliveredAt) throw new WorkflowError("already_delivered", "底片已交付");
  if (!isComplete(item)) {
    const current = currentStep(item);
    throw new WorkflowError(
      "not_deliverable",
      `工序未全部完成${current ? `，还停在「${current.name}」` : ""}，不能交付`,
    );
  }
  item.deliveredAt = nowIso();
  syncStatus(item);
  return item;
}

// ---- 旧底片补当前进度 ----------------------------------------------------

const STEP_NAME_TO_INDEX = new Map(STEPS.map((step, i) => [step.name, i]));

// 旧状态语义：「待X」表示 X 是下一步；旧版入盒动作后写的是「待入盒」，
// 若有入盒记录则以记录为准（evidence 优先），状态只兜底。
const LEGACY_STATUS_FLOOR = {
  待曝光: 1, // 涂布、晾干已过
  冲洗中: 2, // 曝光已过，正在冲洗
  待入盒: 4, // 复晒已过，等待入盒
  待交付: STEPS.length - 1,
  已交付: STEPS.length - 1,
};

function collectEvidence(item) {
  // 同一工序可能在 steps 和 logs 里各有一条，按工序合并，保留最完整的信息
  const byIndex = new Map();

  function absorb(index, at, parts) {
    if (!byIndex.has(index)) byIndex.set(index, { index, at: null, notes: [] });
    const entry = byIndex.get(index);
    for (const part of parts.filter(Boolean)) {
      if (!entry.notes.includes(part)) entry.notes.push(part);
    }
    if (at) entry.at = at;
  }

  for (const record of item.legacySteps || item.steps || []) {
    const index = STEP_NAME_TO_INDEX.get(record.step);
    if (index === undefined) continue;
    absorb(index, record.at || null, [
      record.note,
      record.developStatus ? `显影：${record.developStatus}` : null,
      record.defect ? `缺陷：${record.defect}` : null,
      record.repair ? `修补：${record.repair}` : null,
    ]);
  }
  for (const log of item.logs || []) {
    const index = STEP_NAME_TO_INDEX.get(log.step);
    if (index === undefined) continue;
    absorb(index, log.at || null, [log.note || ""]);
  }

  return [...byIndex.values()].map((entry) => ({
    index: entry.index,
    at: entry.at,
    note: entry.notes.join("；"),
  }));
}

// 给没有标准工序的旧底片补齐六道工序，并按已有记录/旧状态推算当前进度。
// 返回 true 表示发生了补录。
export function backfillWorkflow(item) {
  if (Array.isArray(item.workflow) && item.workflow.length === STEPS.length) {
    syncStatus(item);
    return false;
  }

  const evidence = collectEvidence(item);
  let furthest = evidence.reduce((max, entry) => Math.max(max, entry.index), -1);
  const floor = LEGACY_STATUS_FLOOR[item.status];
  if (floor !== undefined) furthest = Math.max(furthest, floor);

  const dated = (item.logs || []).map((log) => log.at).filter(Boolean).sort();
  const fallbackAt = dated[0] || nowIso();

  item.workflow = createWorkflow();
  for (let i = 0; i <= furthest; i += 1) {
    const hit = evidence.filter((entry) => entry.index === i).pop();
    const step = item.workflow[i];
    step.status = "done";
    step.completedAt = hit?.at || fallbackAt;
    step.attempts = [
      {
        at: step.completedAt,
        result: "pass",
        rework: false,
        note: hit?.note || "旧档补录",
      },
    ];
  }

  if (item.status === STATUS_DELIVERED && !item.deliveredAt) {
    item.deliveredAt = evidence.map((entry) => entry.at).filter(Boolean).pop() || fallbackAt;
  }
  syncStatus(item);
  return true;
}
