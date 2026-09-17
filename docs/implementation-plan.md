# 极简 TypeScript 订单 Agent Loop

以 reference-codes/agent-loop.md 为准。使用 Node 原生 HTTP + 原生浏览器 API，无 Agent、后端或前端框架；仅 ExcelJS 负责 CSV/XLSX 解析。前后端应用代码全部使用 TypeScript，核心代码添加中文注释。

## 文件与流程
- src/agent.ts：有轮数上限的 model → tool → messages 循环，Promise.all 执行同轮工具。
- src/models.ts：fetch 调用兼容 OpenAI 的 Chat Completions API，无假模型回退。
- src/context.ts：解析本次上传表格，创建独立上下文。
- src/tools.ts：概览、数值统计、分组、趋势、成对数值关系、客户复购、保存经验；模型自主选择实际存在的列。
- src/charts.ts：按数据形态把工具结果转成折线、饼图、柱状、散点或表格，并分配正文可引用的 fig-N 编号。
- src/memory.ts：按字段结构召回、存储 Markdown 经验。
- src/hooks.ts：注册表、顺序执行、字符串短路；四个挂载点与文章一致。
- src/task.ts：通过 hook 注入记忆、推送日志、检查完成条件。
- src/server.ts：本机 HTTP 服务，直接接收文件字节并发送 NDJSON 事件流。
- public/app.ts、report.ts、charts.ts、index.html、style.css：上传、任务输入、过程、结果、记忆查看；文章体报告与内联图表渲染。

## 简化边界
CSV 使用 UTF-8（不自动猜编码）；XLSX 使用第一张非空表；首行为列名。最大文件 5 MB、20,000 行、100 列。没有订单 ID 时只统计记录数；金额按行相加，不自动猜测订单头金额去重口径。所有数据来自本次上传，不内置示例订单。模型密钥和名称通过 .env 配置。

展示模型的简要计划/选择依据、工具输入与结果，不索取隐藏思维链。结果计算由 TS 完成；模型负责选工具和解释。记忆只保存模型总结的字段含义、有效分析方法、口径注意事项，提示不要保存客户信息和历史订单数值。每次任务独立 context，历史经验视为参考资料。

## 执行顺序
- [x] 先写 tests/core.test.ts，验证数据变化、无效值、日期、重复订单、hook 短路、真实 loop 回填与退出上限、记忆跨次读取。
- [x] 实现核心 TS 模块，运行 npm test。
- [x] 完成原生 HTTP 与简洁前端，验证上传→工具循环→结果→MD 记忆。
- [x] 编写 README，检查 npm test / npm run build，并完成浏览器页面验证。

## 验证记录

13 项自动测试通过。浏览器测试替身下，第一份文件 4 条记录 / 3 个订单 / 金额 1480；第二份文件 1 条记录 / 1 个订单 / 金额 7，召回同结构记忆。检查了报告、记忆面板及窄屏布局。真实模型服务尚未配置，未声称验证其分析质量。测试数据及浏览器测试记忆保存在 /tmp，不进入工程 memory。独立只读代码审查未发现重要问题。

## 2026-09-15 通用表格分析

按最新要求去除订单预设：SYSTEM 先识别场景，overview 提供列数/重复/去重概况，新增 statistics 工具，分组/趋势接受通用 value 列；同步页面、记忆标题和文档。保留原生 TypeScript loop 和四个 hook。XLSX 命名空间兼容测试通过，模型续轮保留原始消息但不向页面输出内部推理。

## 2026-09-16 文章体报告与多样图表

按要求调整三处，不改整体框架（仍然是 model → tools → messages 循环、四个 hook、NDJSON 事件、无框架依赖）：

1. 图表不再只有条形图。src/charts.ts 按数据形态自动选型：时间序列折线、2–8 组非负构成饼图、含负值或组数多的分类柱状、成对数值散点、清单型结果表格。为此新增 correlate 工具提供成对数值（含皮尔逊相关系数，样本不足或一列无变化时返回 null）。
2. 报告改成文章体：SYSTEM 要求一级标题 + 二级标题 + 连贯正文段落，不再罗列条目。
3. 图表内联进正文：PostToolUse 为每张图分配 fig-N 并写回工具结果，模型在正文里用 [[fig-N]] 指定位置；前端新增 public/report.ts，把 Markdown 文章渲染成 HTML（全部转义、外链只放行 http/https），把图插到对应段落之后，未引用的图附在文末。

验证：npm test 25 项通过（新增图表选型与报告渲染用例，替换旧的"各字段缺失情况"断言），npm run build 通过。仍未改动：CSV/XLSX 解析、记忆口径、模型适配与 hook 语义。
