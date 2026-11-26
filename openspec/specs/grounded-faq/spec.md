# grounded-faq Specification

## Purpose
TBD - created by archiving change add-grounded-faq. Update Purpose after archive.
## Requirements
### Requirement: 基于政策证据回答

系统 SHALL 允许顾客在网页提交有效的中文售后问题。存在可明确支持答案的 FAQ 时，系统 SHALL 一并提供回答、出处标题和支持该回答的政策摘录。

#### Scenario: 回答换货期限问题

- **WHEN** 顾客询问多久内可以申请换货，演示语料存在唯一匹配的期限条目
- **THEN** 页面显示该条目支持的期限结论、来源标题和政策摘录

#### Scenario: 识别等价问法

- **WHEN** 顾客使用已覆盖的另一种表达询问同一换货期限
- **THEN** 页面给出同一政策条款支持的结论和出处

### Requirement: 提示证据不足或请求失败

缺少充分证据时，系统 SHALL 提示顾客补充售后问题的范围。无效输入与服务异常 SHALL 提供可理解的反馈。

#### Scenario: 语料缺少相关证据

- **WHEN** 顾客询问语料未覆盖的问题，或现有证据无法明确支持单一结论
- **THEN** 页面说明现有资料不足，并提示如何补充问题
- **AND** 回复不包含无依据的政策结论或引用

#### Scenario: 输入为空

- **WHEN** 顾客尝试提交空字符串或纯空白
- **THEN** 页面提示输入售后问题，API 拒绝绕过页面直接提交的同类请求

#### Scenario: 问答请求暂时失败

- **WHEN** 问答请求发生网络或服务异常
- **THEN** 页面给出可重试的提示并保留顾客已输入的问题

### Requirement: 从干净环境部署问答

系统 SHALL 提供从干净工作区启动的容器配置。服务就绪时 SHALL 通过同一地址提供问答页面和 API。

#### Scenario: 容器启动后验收问答

- **WHEN** 验收者在具备 Docker Compose 的干净工作区按文档启动服务
- **THEN** 就绪端点可用，网页能提交换货期限问题并显示出处
- **AND** 启动和完成该场景无需提供模型 Key

