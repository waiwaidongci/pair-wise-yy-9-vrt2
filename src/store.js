// 数据存取：JSON 文件的加载、保存、种子数据和底片查找。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorkflow } from "./workflow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "cyanotype-negative-room.json");

const seed = {
  items: [
    {
      code: "CN-001",
      plateSize: "18x24cm",
      chemicalBatch: "B-0620",
      exposure: "8分钟",
      waterSource: "井水过滤",
      box: "蓝盒A-03",
      status: "冲洗中",
      defect: "边角显影不均",
      logs: [{ at: "2026-06-20", step: "曝光", note: "阴天补时2分钟" }],
    },
  ],
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.items ||= [];
  // 旧底片补建工序进度，有改动就落盘
  let changed = false;
  for (const item of db.items) changed = ensureWorkflow(item) || changed;
  if (changed) await saveDb(db);
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function findItem(db, id) {
  return db.items.find(x => x.id === id || x.code === id);
}

export function newId() {
  return "CN-" + Date.now();
}
