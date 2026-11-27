# ShopCare Agent

可部署的电商售后演示。顾客在聊天式页面提交中文售后问题，得到带政策出处的回答，证据不足时可补充信息；也可以领取一笔合成示例订单，在同一条对话里查询订单状态、办理换货。消息按时间顺序追加，输入区固定在页面底部；界面使用 antd 组件库。公开演示默认使用合成 FAQ 语料和确定性关键词检索，无需模型 Key；受控实例可由部署者在服务端启用 DeepSeek 生成。

## 容器启动（推荐验收方式）

需要 Docker 与 Docker Compose。在干净工作区执行：

```bash
docker compose up --build -d
```

服务就绪后：

- 问答页面：<http://localhost:3000>
- 就绪端点：<http://localhost:3000/healthz>，语料有效时返回 `{"status":"ok","faq":{...}}`

查单演示：

1. 点击「领取示例订单」，页面会显示服务端绑定的示例单号。
2. 点击「查询示例订单」或输入 `查订单 SC-...`，结果直接显示单号、商品名和「已签收」。
3. 只输入 `查订单` 时页面提示补充单号，下一轮直接输入该单号即可完成查询。

对话内换货演示：

4. 在输入框发送「我想换货」，按助手提示依次回复「质量问题」或「其他原因」，再选择商品现状「齐全」或「不齐全」。商品状态以明确选项为准，自由文本无法判断时会继续询问。
5. 助手消息中核对待确认摘要、运费说明与政策出处后点击「确认提交」，页面显示 `EX-` 开头的申请编号和「已提交」。直接发送「确认」只会提示点击按钮，不会写入申请。
6. 办理途中可以插问政策问题，回答后继续补充商品申报；缺单号的查单请求会提示先完成或取消换货。
7. 刷新页面后发送「继续换货」恢复原步骤；发送「取消换货」结束办理并作废未提交的确认摘要。

所有问答、查单、换货步骤、摘要与回执都显示在同一条对话流中，订单消息只展示单号、商品、状态和办理提示，不再提供独立的换货表单。

演示会话通过 `HttpOnly` Cookie 识别，订单、会话、换货摘要、申请与对话办理进度保存在 SQLite 中。领取和问答接口按来源 IP 限制每分钟 60 次，超限返回 429。Docker Compose 使用命名卷 `shopcare-data` 挂载到 `/app/data`；`docker compose down` 会保留数据卷，重建容器后原浏览器仍可继续查询未过期的会话、已提交的换货申请和未提交的办理进度。需要清空演示数据时执行：

```bash
docker compose down -v
```

若本机 3000 端口已被占用，可改用 `APP_PORT=3100 docker compose up --build -d`，并把下文地址中的端口相应替换为 3100。

用仓库内冒烟脚本核对就绪、页面、示例订单领取、查单和政策出处：

```bash
pnpm smoke
```

（脚本默认访问 `http://127.0.0.1:3000`，可通过 `BASE_URL` 覆盖。）

停止并清理：

```bash
docker compose down
```

整个预置流程不需要任何模型 Key 或外部数据。

曾使用浏览器直连版本的访客在打开新版页面时，会自动清除同源存储中的旧 DeepSeek Key；新版页面没有 Key 输入或启用入口。

## 本机用真实 Key 验收（推荐）

真实模式没有页面输入框。Key 通过仓库根目录的 `.env` 提供，服务启动时会自动读取；`.env` 已被 `.gitignore` 忽略，仓库只保留不含真实 Key 的 [.env.example](.env.example)。

先复制示例配置：

```powershell
cd d:\Learn\NewProject\company-agent
Copy-Item .env.example .env
```

编辑 `.env`，至少改成：

```dotenv
CHAT_MODE=deepseek
DEEPSEEK_API_KEY=sk-你的真实Key
PORT=3200
```

然后构建并启动：

```powershell
pnpm install
pnpm build
pnpm start
```

- 不需要管理员权限；`pnpm start` 需要构建产物，所以先执行 `pnpm build`。
- 已存在的环境变量优先于 `.env`，临时覆盖时仍可在 PowerShell 里 `$env:CHAT_MODE = "preset"` 等。
- 修改 `.env` 后需要重启服务；关闭服务不会删除文件。
- 当前仓库默认端口 3000，示例使用 `PORT=3200` 避开本机已占用的 3000/3100。

浏览器打开 <http://localhost:3200>。提问「换货期限是多久？」：

- 显示「DeepSeek 生成」：真实 Key 和上游调用成功，正文通过了服务端校验。
- 显示「降级为预置答复」：Key 鉴权、额度、网络或生成结果校验失败，已回退到同一政策的预置答复。
- 显示「生成服务暂时不可用，请稍后重试。」：该问题没有可降级的唯一政策，需要检查 Key、额度或网络后重试。

停止服务用 `Ctrl+C`。`.env` 不要提交；如果不小心把 Key 写进其他文件，请立即在 DeepSeek 控制台轮换。

## 开发模式（热更新）

```powershell
pnpm dev
```

开发模式页面是 <http://localhost:5173>，Vite 固定把 `/api` 代理到 3000。因此：

- 开发时不要在 `.env` 设置 `PORT`，让 API 使用默认 3000；或先把 `PORT` 注释掉再启动。
- 如果本机 3000 已被占用，请释放 3000，或使用上面的 `pnpm build` + `PORT=3200` + `pnpm start` 方式。

## 受控实例启用 DeepSeek（可选）

默认 `CHAT_MODE=preset`，公开演示不会发起模型请求。受控本地或私有实例可以让服务端调用 DeepSeek：

```bash
CHAT_MODE=deepseek DEEPSEEK_API_KEY=sk-... pnpm start
```

使用容器时同样在运行时注入：

```bash
CHAT_MODE=deepseek DEEPSEEK_API_KEY=sk-... docker compose up --build -d
```

Windows PowerShell：

```powershell
$env:CHAT_MODE = "deepseek"
$env:DEEPSEEK_API_KEY = "sk-你的真实Key"
$env:APP_PORT = "3200"
docker compose up --build -d
```

容器方式不需要本机 Node 或管理员权限，但需要 Docker Desktop 正在运行；首次启动会构建镜像。停止用 `docker compose down`。

- 部署 Key 只由 Fastify 运行时读取，只会进入服务端发往 `https://api.deepseek.com/chat/completions` 的鉴权头；浏览器、API 响应、日志和构建产物都不包含 Key。
- 真实模式缺少 Key 时启动失败，错误只报告变量名。
- 回答会标明「DeepSeek 生成」。生成正文必须通过候选身份、引文来源和政策事实校验；上游失败或校验不通过时，能独立确认政策就降级并标注「降级为预置答复」，否则提示补充信息或返回可重试错误。
- 公开实例保持 `preset`。浏览器始终只访问同源问答接口，CSP 不开放外部模型域名。

## 本地开发

需要 Node.js 24：服务端使用内置 `node:sqlite` 保存演示会话和订单。默认数据库文件是 `data/shopcare.sqlite`（已被 `.gitignore` 忽略），可用 `DATABASE_PATH` 覆盖。

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

`pnpm build` 由 Vite 生成 `dist/web`，TypeScript 编译 `dist/server`。Fastify 同源提供页面、`POST /api/chat`、`POST /api/demo/session`、`POST /api/exchange/preview`、`POST /api/exchange/confirm` 与 `GET /healthz`。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
```
