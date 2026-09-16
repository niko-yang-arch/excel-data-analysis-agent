# 极简通用表格分析 Agent Loop

按照 [参考文章](reference-codes/agent-loop.md) 的 `model → tools → messages → model` 方式手写。应用逻辑全部使用 TypeScript，不使用 LangGraph、Agent SDK、Express、React 等框架。运行依赖只有解析 CSV/XLSX 的 ExcelJS 与 JSZip。

## 启动

需要 Node.js 22+。

```bash
npm install
cp .env.example .env
# 编辑 .env，填入模型服务地址、密钥和模型名称
npm start
```

浏览器打开 http://127.0.0.1:3000 。必须使用支持 Chat Completions **tool calling** 的模型服务：

```dotenv
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=你的密钥
MODEL_NAME=你的模型名称
PORT=3000
```

兼容服务可替换 BASE_URL，例如 `https://你的服务地址/v1`；代码会追加 `/chat/completions`。密钥只保存在后端。未配置时页面可打开，但分析会明确提示配置，不使用假模型替代。

## 使用

1. 上传自己的 CSV 或 XLSX，首行为唯一且非空的列名。
2. 可填写关注点，也可留空让模型先识别表格含义，再自主选择指标。
3. 观察执行摘要、工具输入与结果；完成后查看或下载 Markdown 报告。
4. 点击「查看记忆」检查 `memory/*.md`，上传同字段结构的表格会自动召回。

CSV 使用 UTF-8；XLSX 读取第一张非空工作表，仅使用公式已有的缓存结果。部分工具导出的 XLSX 会给标签加命名空间前缀（如 `<x:workbook>`），解析前会自动归一化，正常文件不受影响。最大 5 MB、20,000 行、100 列。不内置业务数据，测试样例只存在于测试中。

## 五个元素与中文注释

| 元素 | 文件 | 职责 |
|---|---|---|
| models | `src/models.ts` | 用原生 fetch 调用模型 |
| tools | `src/tools.ts` | 概览、数值统计、分组、趋势、可选订单复购、保存经验 |
| context | `src/context.ts`、`src/task.ts` | 当前表格、样本、任务及 messages |
| memory | `src/memory.ts` | 按列名集合匹配并读写 Markdown |
| hooks | `src/hooks.ts`、`src/task.ts` | 注册、短路、记忆注入、日志、完成检查 |

核心循环在 `src/agent.ts`，不包含具体业务分析逻辑：

```ts
const response = await model(messages, tools);
messages.push(response);
// 模型请求工具时：
const results = await Promise.all(response.tool_calls.map(async call => {
  // PreToolUse → await tool.run(args) → PostToolUse
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) };
}));
messages.push(...results); // 下一轮模型会看到计算结果，自行决定继续或结束
```

四个 hook 与文章一致：

- `UserPromptSubmit`：读取同结构 MD 经验，追加到本次上下文。
- `PreToolUse`：展示工具调用；未检查数据时阻止提前保存经验。
- `PostToolUse`：展示实际计算结果，记录检查与记忆是否完成。
- `Stop`：缺少数据检查或记忆时返回补充指令，让 loop 继续；最多 10 轮防止无限循环。

`Promise.all` 并行等待同轮工具；`async/await` 贯穿模型、工具与 hook。后端将事件逐条发送为 NDJSON，前端 `ReadableStream` 持续读取，不等整个任务结束。展示的是模型简要计划、选择依据、工具事实，不读取隐藏推理字段，也不是逐 token 输出。

## 数据与记忆口径

- 所有计算都使用本次上传的数据；每个请求独立 messages，不混入历史记录。
- 不预设业务场景；支持成绩、人员、库存、实验、财务、订单等规则表格。概览输出行列数、重复行、各列缺失和去重数。statistics 计算有效数、均值、中位数与范围；group_by / trend 的 value 参数指定可相加的数值列。复购工具仅适用于明确的客户订单数据。
- 无效数值/日期明确计数。百分号转为小数比例，支持科学计数法；混合单位不能直接合计。分组最多前 20 组，趋势最多最近 60 期；复购仅代表当前文件内的订单。
- 记忆文件名为列名集合的哈希；同结构更新同一个 MD，不同结构独立。模型总结字段含义、分析方法和口径提醒，提示其不要保存客户信息、原始订单或历史数值；这是提示约束，不是自动脱敏保证。
- 上传文件只在内存中解析，不保存原表。模型服务会收到列名、前 3 行样本、工具统计及相关记忆。停止分析前已成功保存的经验会保留。
- 可直接编辑或删除 `memory/*.md`；它们和 `.env` 都被 Git 忽略。并发同结构任务以最后成功写入的经验为准。

## 验证

```bash
npm test
```

测试覆盖 CSV/XLSX、动态数据隔离、金额/日期异常、独立订单与复购、hook 短路、工具结果回填、Stop 续跑与轮数上限、模型协议、HTTP 上传流和 MD 跨次召回。测试通过脚本模型/本地 HTTP 替身验证调用链，不调用收费模型、不污染工程记忆；真实模型需要用户自己的配置。

这是绑定 `127.0.0.1` 的个人 demo，没有账号、数据库、任务队列、Agent 框架或生产部署流程。

本轮已配置 MiniMax（密钥仅在被忽略的 .env），模型续轮保留服务要求的原始消息，页面只展示公开摘要。XLSX 命名空间兼容与通用数值统计均有回归测试。当前仍要求首行是列名，支持 CSV / XLSX、第一张非空工作表；旧 .xls、合并多层表头、加密文件不在本极简版支持范围内。

## 分析图表

最终结果自动展示工具计算对应的 SVG 图表：分类柱状图、日期趋势折线图、数值概况图，以及字段缺失情况图。模型通过选择分析工具决定展示内容；图表数值不由模型编造。每张图可查看数据并下载 SVG；原有 Markdown 下载只含文字报告。时间趋势按真实日期间隔绘制，未出现的日期不会补零。保持纯 TypeScript + 浏览器 SVG，无新增依赖。
