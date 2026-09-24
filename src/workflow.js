// 工序规则：六道标准工序的顺序、提交、失败返工和底片状态推导。
export const STEPS = ["涂布", "晾干", "曝光", "冲洗", "复晒", "入盒"];

// 步骤状态：待执行（未轮到）→ 待提交（当前步）→ 已完成；失败时为 失败待返工
export function createWorkflow() {
  return STEPS.map((name, i) => ({
    name,
    status: i === 0 ? "待提交" : "待执行",
    failureReason: "",
    records: [],
  }));
}

export function currentStep(item) {
  return (item.workflow || []).find(s => s.status === "待提交" || s.status === "失败待返工") || null;
}

// 底片状态完全由工序进度推导，不允许手工改
export function deriveStatus(item) {
  if (item.delivered) return "已交付";
  const steps = item.workflow || [];
  if (steps.length && steps.every(s => s.status === "已完成")) return "待交付";
  const cur = currentStep(item);
  if (cur && cur.status === "失败待返工") return "返工中";
  return "进行中";
}

function touch(item) {
  item.status = deriveStatus(item);
}

function log(item, step, note) {
  item.logs ||= [];
  item.logs.push({ at: new Date().toISOString(), step, note });
}

// 提交当前工序。input: { result: "pass" | "fail", reason?, note? }
// 失败时停在原步并记录原因；失败后的下一次提交记为返工，返工通过才能推进。
export function submitStep(item, name, input) {
  const step = (item.workflow || []).find(s => s.name === name);
  if (!step) return { error: `未知工序「${name}」`, status: 404 };
  const cur = currentStep(item);
  if (cur && step !== cur) {
    return { error: `当前轮到「${cur.name}」，不能提交「${name}」`, status: 409 };
  }
  if (!cur) return { error: "工序已全部完成，等待交付", status: 409 };

  const result = input.result;
  if (result !== "pass" && result !== "fail") return { error: "result 只能是 pass 或 fail", status: 400 };
  const reason = (input.reason || "").trim();
  const note = (input.note || "").trim();
  if (result === "fail" && !reason) return { error: "记录失败时必须填写失败原因", status: 400 };

  const rework = cur.status === "失败待返工";
  cur.records.push({
    at: new Date().toISOString(),
    type: rework ? "返工" : "提交",
    result: result === "pass" ? "通过" : "失败",
    reason,
    note,
  });

  if (result === "fail") {
    cur.status = "失败待返工";
    cur.failureReason = reason;
    log(item, cur.name, `${rework ? "返工" : "提交"}失败：${reason}`);
  } else {
    cur.status = "已完成";
    cur.failureReason = "";
    const idx = item.workflow.indexOf(cur);
    const next = item.workflow[idx + 1];
    if (next && next.status === "待执行") next.status = "待提交";
    log(item, cur.name, rework ? "返工通过" : "提交通过");
  }
  touch(item);
  return { item };
}

// 入盒完成（待交付）后才允许交付
export function deliver(item) {
  if (deriveStatus(item) !== "待交付") {
    return { error: "六道工序全部完成后才能交付", status: 409 };
  }
  item.delivered = true;
  item.deliveredAt = new Date().toISOString();
  touch(item);
  log(item, "交付", "底片已交付");
  return { item };
}

// 旧底片补建工序：按已有记录推断完成到哪一步，返回是否有改动
export function ensureWorkflow(item) {
  if (Array.isArray(item.workflow) && item.workflow.length === STEPS.length
      && item.workflow.every((s, i) => s.name === STEPS[i])) {
    return false;
  }
  const workflow = createWorkflow();
  const history = [...(item.logs || []), ...(item.steps || [])];
  let doneThrough = -1;
  if (item.delivered || item.status === "已交付") {
    doneThrough = STEPS.length - 1;
    item.delivered = true;
  } else {
    for (const entry of history) {
      const idx = STEPS.indexOf(entry.step);
      if (idx > doneThrough) doneThrough = idx;
    }
  }
  for (let i = 0; i <= doneThrough; i++) {
    workflow[i].status = "已完成";
    workflow[i].records.push({ at: item.logs?.[0]?.at || new Date().toISOString(), type: "补录", result: "通过", reason: "", note: "旧底片进度回填" });
  }
  for (const s of workflow) {
    if (s.status !== "已完成") { s.status = "待提交"; break; }
  }
  item.workflow = workflow;
  touch(item);
  return true;
}

export function summarize(item) {
  const cur = currentStep(item);
  const logCount = (item.logs || []).length
    + (item.workflow || []).reduce((n, s) => n + (s.records || []).length, 0);
  return {
    ...item,
    status: deriveStatus(item),
    currentStep: cur ? cur.name : null,
    logCount,
  };
}
