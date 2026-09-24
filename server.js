// HTTP 入口：只启动服务并把请求交给路由层。
// 数据存取见 src/store.js，工序规则见 src/workflow.js，接口路由见 src/routes.js。

import http from "node:http";
import { handle, handleError } from "./src/routes.js";

const port = Number(process.env.PORT || 3040);

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    handleError(res, error);
  }
});

server.listen(port, () =>
  console.log("古法蓝晒底片整理室 listening on http://localhost:" + port),
);
