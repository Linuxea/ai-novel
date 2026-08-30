# 事件信封与 outbox

## 事件命名

领域事件使用 `<module>.<aggregate>.<fact>.v<major>`，全部采用小写英文，单词间使用下划线；需要细分时可以在版本前增加事实段。事件描述已经发生的事实，不使用命令式名称。

有效示例：

- `canon.character.created.v1`
- `narrative.foreshadow.resolved.v1`
- `manuscript.chapter.content_revised.v2`

首段必须是六个业务模块之一。`v<major>` 从 `v1` 开始，只有不兼容的载荷或语义变化才增加；旧版本在消费者完成迁移前继续可读。`metadata.schemaVersion` 必须与当前事件载荷契约版本一致。

事件名是品牌类型，业务代码先通过 `parseDomainEventName` 解析，事件信封只能通过 `createEventEnvelope` 构造。构造器会拒绝空段、非正安全整数版本，以及事件名模块、聚合段、版本分别与 `aggregate.module`、`aggregate.aggregateType`、`metadata.schemaVersion` 不一致的输入。

## 统一信封

`EventEnvelope` 包含：

- `eventId`：全局唯一、不可复用，是消费者幂等键。
- `eventName`：版本化事件名。
- `occurredAt`：领域事务提交时确定的 UTC 时间。
- `aggregate`：模块、聚合类型、聚合标识和事件发生后的聚合版本。
- `correlationId`：贯穿一次用户请求或后台流程。
- `causationId`：触发当前事件的命令或前序事件标识；首个动作可省略。
- `payload`：事件自身的最小事实载荷，不复制完整聚合，不携带密钥。
- `metadata`：载荷 schema 版本和可选操作者标识。

信封一旦写入不可修改。修正错误事实需要提交新的补偿命令和事件，不能覆盖历史记录。

## 事务 outbox

聚合状态、变更集、领域事件信封与 outbox 记录必须在同一个 SQLite 事务中提交。事务回滚时四者全部不可见；事务成功后，即使进程在响应前退出，待投递记录仍然存在。

投递器按以下语义运行：

1. 领取 `pending` 且 `availableAt` 已到期的记录，并避免同一记录被并发工作器同时处理。
2. 将完整信封交给进程内消费者或外部适配器。
3. 成功后标记 `published` 并记录 `publishedAt`；失败时增加 `attempts`，按退避策略更新下次时间。
4. 达到重试上限后标记 `failed`，保留载荷和关联标识供诊断与受控重放。

`OutboxMessage` 是判别联合：`pending` 必须有 `availableAt`，`published` 必须有 `publishedAt`，`failed` 必须有 `failedAt` 和 `failureCode`；互斥状态字段不能同时出现。

## 一致性保证

- outbox 提供至少一次投递，不承诺恰好一次。消费者先以 `eventId` 去重，再执行副作用。
- 只保证单个聚合可按 `aggregate.version` 检查顺序，不假设跨聚合全局顺序。
- 消费者发现版本缺口时延迟重试或从权威聚合重建投影，不能静默跳过。
- 消费者失败不回滚已经提交的领域事务；需要业务补偿时发送新命令。
- 站内同步不变量由原事务保证，事件用于事务后的投影、索引、通知和后台智能任务。
