# SQLite、后台任务与可观测性平台

## SQLite 连接与迁移

新平台数据库默认位于 `data/ai-novel.sqlite`，可通过 `DATABASE_PATH` 或连接工厂参数覆盖。它与仍在服役的 `data/projects/<id>/` 文件存储是两个独立边界；平台连接、迁移、备份和恢复均不得遍历、导入或修改旧项目目录。

连接工厂使用 `drizzle-orm/node-sqlite` 与 Node 内置 `node:sqlite`，创建父目录后启用 WAL、`foreign_keys` 和 `busy_timeout`。`src/platform/database/schema.ts` 聚合各平台 schema，`drizzle.config.ts` 只用于从 TypeScript schema 生成 `drizzle/` 下的版本化 SQL。应用和维护命令都通过 Drizzle migrator 应用这些文件，不以运行时 `push` 推断或改写 schema。

受控单例显式提供关闭入口，测试必须传入临时文件路径并在结束时关闭。默认路径和测试覆盖都不能指向 `data/projects`。

作品目录切片通过后续真实迁移增加 `projects` 与 `project_model_preferences`。项目仓储位于 `src/modules/projects/infrastructure`，平台 schema 只聚合表定义与迁移输入；业务命令仍通过模块端口和组合根访问数据库，不从 API 或 UI 直接执行 SQL。

## 同步 Unit of Work

Unit of Work 以一个短暂的 SQLite `BEGIN IMMEDIATE` 事务包裹同步回调。模块仓储、未来的 change set 写入器和 outbox 仓储共享同一个事务上下文，因此业务状态、审计变化和领域事件只能全部提交或全部回滚。

`node:sqlite` 是同步驱动。事务回调在类型和运行时都拒绝 Promise；AI、网络、流式生成及其他慢操作必须在提交后由 outbox 或 job worker 执行。异常会回滚，嵌套 Unit of Work 会被拒绝。

## 备份、检查与恢复

`assertDatabaseIntegrity` 执行 SQLite `integrity_check`。`backupDatabase` 使用 SQLite 在线备份 API 将一致性快照写到同目录临时文件，验证后再原子改名。`restoreDatabase` 先验证/复制到临时库，再执行完整性检查和原子替换；如果目标库由平台连接工厂打开，恢复直接拒绝。

维护命令为：

```bash
npm run db:generate
npm run db:migrate
npm run db:check
npm run db:backup -- backups/ai-novel.sqlite
npm run db:restore -- backups/ai-novel.sqlite
```

CLI 恢复前必须停止应用和工作器。SQLite 备份不包含旧 `data/projects`，旧业务数据仍按原导出/备份流程保护。

## Outbox 与进程内事件

`domain_events` 是持久 transactional outbox。不可变的 branded `EventEnvelope` 与业务事务一起入库；内部状态为 `pending`、`processing`、`published`、`failed`，并保存 attempts、availableAt、租约 owner/token/expiry、publishedAt、failedAt、failureCode 和最后错误。

dispatcher 只原子领取当前已有 handler 的到期记录，未处理事件继续保持 pending；租约过期后允许其他工作器恢复。所有 handler 成功后才标记 published；失败按注入或指数退避重新排队，达到最大次数后保留为 dead-letter。交付语义是至少一次，消费者必须使用 `eventId` 作为幂等键。没有注册 handler 时 dispatcher 不领取记录。

进程内 EventBus 按版本化事件名提供类型化订阅、取消订阅与异步发布。多个 handler 顺序执行；任一失败都会让本次 outbox 交付失败，因此已执行 handler 也必须幂等。

## 持久任务与 runner

`jobs` 保存 queued、running、succeeded、failed、cancelled 状态以及类型内唯一的幂等键、payload、attempt/maxAttempts、runAt、租约、进度、result/error、取消请求和时间戳。入队使用唯一约束保证并发幂等；领取使用短事务和租约 token，只有持有当前 token 的工作器能更新进度或进入终态。过期租约可恢复，旧工作器的迟到提交不会改变状态。

排队任务可立即取消；运行任务先记录 `cancelRequestedAt`，handler 通过 `signal`、`isCancellationRequested` 或 `throwIfCancelled` 协作停止，再由当前租约确认 cancelled。runner 只领取已注册类型，按错误分类决定重试或失败，并支持注入 clock、ID 和 backoff。

每次入队、领取、进度、重试、取消和完成都在同一状态事务中追加到 `job_events`。自增 cursor 是后续 SSE 的持久重放游标；读取方按 `afterCursor` 续传，不依赖内存广播。

## 日志与启动

结构化 logger 通过异步关联上下文传播 `requestId`、`jobId`、`generationId` 和 `changeSetId`。Error 被转换为安全结构，authorization、API key、token、password、cookie 与 secret 字段递归脱敏；业务代码不直接写 console。

`src/instrumentation.ts` 只在非构建、非测试的 Node runtime 启动平台工作器。`PLATFORM_WORKERS_ENABLED=false` 可显式关闭，`PLATFORM_WORKER_INTERVAL_MS` 设置轮询间隔。运行状态保存在 `Symbol.for` 全局单例中，避免开发热更新重复定时器；定时器支持 `unref` 和显式停止，未注册事件或任务 handler 时安全空转。
