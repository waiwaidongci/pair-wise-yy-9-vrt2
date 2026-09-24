// 入口：只负责启动 HTTP 服务，业务分散在 src/store（数据存取）、src/workflow（工序规则）、src/routes（接口路由）。
import http from "node:http";
import { handleApi } from "./src/routes.js";
import { page } from "./src/page.js";

const port = Number(process.env.PORT || 3040);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page());
      return;
    }
    if (await handleApi(req, res, url)) return;
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () => console.log("古法蓝晒底片整理室 listening on http://localhost:" + port));
