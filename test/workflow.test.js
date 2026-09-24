import test from "node:test";
import assert from "node:assert/strict";
import {
  STEPS,
  createWorkflow,
  currentStep,
  deriveStatus,
  submitStep,
  deliver,
  isComplete,
  backfillWorkflow,
  WorkflowError,
} from "../src/workflow.js";

function newItem() {
  return { code: "CN-T", workflow: createWorkflow(), deliveredAt: null, logs: [] };
}

test("建档生成六个待执行项，顺序为涂布到入盒", () => {
  const workflow = createWorkflow();
  assert.equal(workflow.length, 6);
  assert.deepEqual(workflow.map((s) => s.name), ["涂布", "晾干", "曝光", "冲洗", "复晒", "入盒"]);
  assert.ok(workflow.every((s) => s.status === "pending"));
  const item = newItem();
  assert.equal(currentStep(item).name, "涂布");
  assert.equal(deriveStatus(item), "待涂布");
});

test("不能越过当前步骤提交后面的工序", () => {
  const item = newItem();
  assert.throws(() => submitStep(item, "exposure", { result: "pass" }), WorkflowError);
  assert.equal(currentStep(item).name, "涂布");
  assert.equal(item.workflow[2].status, "pending");
});

test("失败必须写原因，停在原处，后续步骤不能完成", () => {
  const item = newItem();
  assert.throws(() => submitStep(item, "coating", { result: "fail", note: "" }));
  submitStep(item, "coating", { result: "fail", note: "药液涂布不均" });
  assert.equal(item.workflow[0].status, "failed");
  assert.equal(item.workflow[0].failReason, "药液涂布不均");
  assert.equal(currentStep(item).name, "涂布");
  assert.equal(deriveStatus(item), "待涂布");
  // 仍然停在涂布，晾干不能越步
  assert.throws(() => submitStep(item, "drying", { result: "pass" }), WorkflowError);
});

test("返工通过后才能继续，返工有记录，失败原因保留在历史中", () => {
  const item = newItem();
  submitStep(item, "coating", { result: "fail", note: "涂布不均" });
  // 返工通过：备注可留可不留
  const { attempt } = submitStep(item, "coating", { result: "pass", note: "重涂均匀" });
  assert.equal(attempt.rework, true);
  assert.equal(item.workflow[0].status, "done");
  assert.equal(item.workflow[0].failReason, null);
  assert.equal(item.workflow[0].attempts[0].result, "fail");
  assert.equal(item.workflow[0].attempts[0].note, "涂布不均");
  assert.equal(currentStep(item).name, "晾干");
});

test("六道全部通过后显示待交付，交付后结束", () => {
  const item = newItem();
  for (const step of STEPS) submitStep(item, step.key, { result: "pass" });
  assert.ok(isComplete(item));
  assert.equal(deriveStatus(item), "待交付");
  assert.equal(currentStep(item), null);
  assert.throws(() => submitStep(item, "boxing", { result: "pass" }), WorkflowError);
  deliver(item);
  assert.equal(deriveStatus(item), "已交付");
  assert.ok(item.deliveredAt);
  assert.throws(() => deliver(item), WorkflowError);
});

test("未完成全部工序不能交付", () => {
  const item = newItem();
  submitStep(item, "coating", { result: "pass" });
  assert.throws(() => deliver(item), /还停在/);
});

test("已完成步骤不能重复提交", () => {
  const item = newItem();
  submitStep(item, "coating", { result: "pass" });
  assert.throws(() => submitStep(item, "coating", { result: "pass" }), WorkflowError);
});

test("旧底片按入盒记录补齐六道，状态为待交付", () => {
  const legacy = {
    code: "CN-001",
    status: "待入盒",
    defect: "边角显影不均",
    logs: [
      { at: "2026-06-20", step: "曝光", note: "阴天补时2分钟" },
      { at: "2026-06-21T03:50:30.042Z", step: "入盒", note: "放入A盒" },
    ],
    steps: [
      {
        at: "2026-06-21T03:50:30.042Z",
        step: "入盒",
        developStatus: "稳定",
        defect: "边角显影不均",
        repair: "边角重涂",
        note: "放入A盒",
      },
    ],
  };
  const changed = backfillWorkflow(legacy);
  assert.equal(changed, true);
  assert.equal(legacy.workflow.length, 6);
  assert.ok(legacy.workflow.every((s) => s.status === "done"));
  assert.equal(deriveStatus(legacy), "待交付");
  assert.equal(legacy.workflow[5].attempts[0].note, "放入A盒；显影：稳定；缺陷：边角显影不均；修补：边角重涂");
});

test("旧底片按旧状态兜底补进度：冲洗中=待冲洗", () => {
  const legacy = {
    code: "CN-OLD",
    status: "冲洗中",
    logs: [{ at: "2026-03-01", step: "曝光", note: "正常曝光" }],
  };
  backfillWorkflow(legacy);
  assert.equal(legacy.workflow.filter((s) => s.status === "done").length, 3);
  assert.equal(currentStep(legacy).name, "冲洗");
  assert.equal(deriveStatus(legacy), "待冲洗");
});

test("已交付的旧底片补录后保持已交付", () => {
  const legacy = {
    code: "CN-DONE",
    status: "已交付",
    logs: [{ at: "2026-04-01", step: "入盒", note: "入盒" }],
  };
  backfillWorkflow(legacy);
  assert.ok(legacy.deliveredAt);
  assert.equal(deriveStatus(legacy), "已交付");
});
