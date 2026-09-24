// 数据存取层：只管 JSON 文件的加载、落盘和底片的增删查。
// 首次加载时给旧底片补录标准工序与当前进度。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backfillWorkflow, syncStatus } from "./workflow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "cyanotype-negative-room.json");

const seed = {
  items: [
    {
      code: "CN-002",
      plateSize: "20x30cm",
      chemicalBatch: "B-0924",
      exposure: "10分钟",
      waterSource: "井水过滤",
      box: "蓝盒A-05",
      createdAt: "2026-09-24T01:00:00.000Z",
    },
  ],
};

let cache = null;

async function loadRaw() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

export async function save(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
  cache = db;
}

// 加载并迁移：补齐 id、为旧底片补录工序，状态统一由工序进度派生
export async function load() {
  if (cache) return cache;
  const db = await loadRaw();
  db.items ||= [];
  let changed = false;

  for (const item of db.items) {
    if (!item.id) {
      item.id = item.code || `CN-${Date.now()}`;
      changed = true;
    }
    if (backfillWorkflow(item)) changed = true;
    const before = item.status;
    syncStatus(item);
    if (before !== item.status) changed = true;
  }

  if (changed) await save(db);
  cache = db;
  return db;
}

export async function listItems() {
  const db = await load();
  return db.items.map((item) => {
    syncStatus(item);
    return item;
  });
}

export async function findItem(id) {
  const db = await load();
  return db.items.find((item) => item.id === id || item.code === id) || null;
}

export async function addItem(item) {
  const db = await load();
  db.items.unshift(item);
  await save(db);
  return item;
}

export async function persist() {
  await save(await load());
}
