## Why

用一个可在浏览器验收的售后问题建立 ShopCare Agent 的第一条业务路径。这个路径为后续模型接入、查单和换货提供统一的对话入口，并建立回答可核查出处的基线。

## What Changes

- 提供最小顾客对话页，支持输入中文售后问题和查看回答来源。
- 使用公开演示语料提供可重复的政策问答。找到相关证据时返回带出处的回答，证据不足时提示用户提供更具体的信息。
- 提供单容器的本地部署方式。启动后通过同源网页验收问答，并可检查服务是否就绪。
- 真实 DeepSeek 调用、订单与 SQLite 状态、换货 Flow 和模拟坐席分别由后续 Change 交付。

## Capabilities

### New Capabilities

- `grounded-faq`: 通过顾客网页查询售后政策，查看回答及其证据，并体验证据不足的提示。

### Modified Capabilities

## Impact

- 增加 React/Vite 顾客页面和 Fastify 问答 API。部署时由 Fastify 同源提供前端资源。
- 增加合成售后 FAQ、确定性的中文关键词检索、行为测试和 Docker 启动说明。
