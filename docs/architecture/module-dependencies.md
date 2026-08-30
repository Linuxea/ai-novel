# 模块依赖规则

## 模块内部方向

每个垂直模块按需要使用 `domain`、`application`、`infrastructure`、`presentation` 四层，依赖只能由外向内：

1. `domain` 包含实体、值对象、不变量和领域事件，只依赖本模块领域代码与 `@/shared/contracts`。
2. `application` 编排命令、查询和事务，依赖本模块 domain。需要外部能力时声明端口；需要其他模块时只引用对方公开入口。
3. `infrastructure` 实现应用端口，可以依赖本模块 application/domain、平台公开入口和第三方技术包。
4. `presentation` 提供 Next.js route、server action 和 React 适配，只调用 application 用例，不承载领域规则。

Next.js composition root 负责组装公开模块与平台适配器。组合代码可以看见多个公开入口，但不得成为新的业务层。

## 强制边界

- 跨模块和跨平台能力导入必须分别精确使用 `@/modules/<module>`、`@/platform/<capability>`；相对跨越、根入口、`index.ts` 后缀和任何子路径都禁止。
- 同一模块内部使用相对路径，不能借助路径别名绕过公开入口。
- domain 的运行时裸包白名单只有 `zod`；仅 `import type` 可以引用 `node:*` 类型。`fs`、运行时 `node:*`、React、TanStack、Next、Drizzle、SQLite 驱动和 AI SDK 均禁止。项目内只能相对导入本模块 domain 或精确导入 `@/shared/contracts`。
- `src/shared/contracts` 禁止依赖 app、旧 lib、业务模块或平台实现；共享目录不放通用业务实体和便利函数。
- platform 如需实现模块端口，只能从模块公开入口取得契约，禁止访问模块内部文件。
- 循环依赖通过领域事件、应用端口或上移编排解决，不以重新导出内部文件规避。
- 服务端基础设施不得进入 Client Component；浏览器代码不得直接访问数据库、文件系统或密钥。

## 公开入口准则

模块入口只导出其他模块真正需要的命令、查询 DTO、事件契约和端口。实体内部结构、仓储实现、ORM schema、React 组件和私有辅助函数不导出。修改公开入口视为架构决策，需要同步契约测试与调用方。

平台能力同样从精确的 `@/platform/<capability>` 入口使用；`@/modules` 和 `@/platform` 根入口不作为跨边界捷径。

## 自动化护栏

`eslint.config.mjs` 使用自定义边界规则提供即时反馈，并将相对导入解析为真实绝对路径。`tests/architecture/source-import-boundaries.test.ts` 独立使用 TypeScript 语法树解析 `src` 内每个源文件的 import、export 和动态 import，语法诊断或边界违规都会使测试失败；反例同时覆盖裸包白名单、相对路径逃逸、动态导入以及模块和平台内部入口。TypeScript 编译和分层测试继续覆盖公开入口是否可解析。人工评审负责识别尚不能由静态规则表达的业务越权。
