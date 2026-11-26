# ShopCare Agent

可部署的电商售后演示：顾客在网页提交中文售后问题，得到带政策出处的回答；证据不足时引导补充信息。当前版本使用合成 FAQ 语料和确定性关键词检索，无需模型 Key。

## 容器启动（推荐验收方式）

需要 Docker 与 Docker Compose。在干净工作区执行：

```bash
docker compose up --build -d
```

服务就绪后：

- 问答页面：<http://localhost:3000>
- 就绪端点：<http://localhost:3000/healthz>，语料有效时返回 `{"status":"ok","faq":{...}}`

若本机 3000 端口已被占用，可改用 `APP_PORT=3100 docker compose up --build -d`，并把下文地址中的端口相应替换为 3100。

用仓库内冒烟脚本核对就绪、页面和两种等价问法的出处：

```bash
pnpm smoke
```

（脚本默认访问 `http://127.0.0.1:3000`，可通过 `BASE_URL` 覆盖。）

停止并清理：

```bash
docker compose down
```

整个流程不需要任何模型 Key 或外部数据。

## 本地开发

```bash
pnpm install
pnpm dev
```

- Vite 页面：<http://localhost:5173>，`/api` 代理到 Fastify。
- Fastify API：<http://localhost:3000>。

## 生产构建

```bash
pnpm build
pnpm start
```

`pnpm build` 由 Vite 生成 `dist/web`，TypeScript 编译 `dist/server`；Fastify 同源提供页面、`POST /api/chat` 与 `GET /healthz`。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
```
