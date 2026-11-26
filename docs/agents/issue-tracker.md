# Issue 跟踪

执行票位于 `jimchou-h/shopcare-agent` 的 GitHub Issues，通过 `gh` 操作。打开本地克隆后使用 `origin` 确定仓库。PR 用于交付和评审，问题入口为 GitHub Issues。

- 每张票关联 OpenSpec Change 和 `tasks.md` 中的任务编号。票面包含可验收的结果、依赖和验收标准。以 OpenSpec 维护范围及任务状态。
- 创建 issue 用 `gh issue create --title "..." --body-file <file>`。读取用 `gh issue view <number> --comments`，查询用 `gh issue list --state open`。
- 用 `gh issue edit <number> --add-label <label>` 或 `--remove-label <label>` 更新分诊状态。
- 验收条件全部通过且实现已推送或 PR 已合并后，按统一开发工作流核对映射、更新 `tasks.md`、关闭 issue 并汇报结果。
