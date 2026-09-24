# 古法蓝晒底片整理室

运行：

```bash
npm start
```

访问`http://localhost:3040`。数据保存在`data/cyanotype-negative-room.json`。

## 标准工序

每张底片建档时自动生成六道待执行工序，必须按顺序提交：

**涂布 → 晾干 → 曝光 → 冲洗 → 复晒 → 入盒 → 交付**

- 每次只轮到当前一步，越步提交会被拒绝；
- 记录失败必须填原因，底片停在该步进入「返工中」，返工通过后才能继续；
- 底片状态由工序进度推导：进行中 / 返工中 / 待交付（入盒完成）/ 已交付；
- 旧底片在加载时自动补建工序，并按已有记录回填进度。

## 代码结构

- `server.js` — 入口，只负责启动 HTTP 服务
- `src/store.js` — 数据存取（JSON 文件读写、种子数据、旧数据回填触发）
- `src/workflow.js` — 工序规则（顺序、提交、失败返工、状态推导）
- `src/routes.js` — 接口路由（`/api/items`、`/api/items/:id/steps/:step/submit`、`/api/items/:id/deliver`、`/api/stats` 等）
- `src/page.js` — 页面模板
