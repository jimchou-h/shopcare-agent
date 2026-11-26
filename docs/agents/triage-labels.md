# 分诊标签

- `needs-triage` 等待评估和分诊。
- `needs-info` 等待补足需求、复现证据或外部依赖信息。
- `ready-for-agent` 规格完整、依赖已就绪，可以由 Agent 独立完成。
- `ready-for-human` 需要人工操作、判断或审批。
- `wontfix` 已决定关闭且无需实现，保留决策理由。

使用以上字面值作为 GitHub 标签名。标记可开工前核对验收条件和阻塞关系。
