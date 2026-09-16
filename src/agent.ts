import { Hooks } from './hooks.js';
import type { Message, Model, Tools } from './types.js';

// 核心循环只管：模型 → 工具 → 结果回填 → 模型。日志、记忆与完成检查交给 hooks。
export async function agentLoop({ messages, tools, model, hooks = new Hooks(), onText = () => {}, maxTurns = 10 }: {
  messages: Message[]; tools: Tools; model: Model; hooks?: Hooks;
  onText?: (text: string) => void; maxTurns?: number;
}): Promise<string> {
  await hooks.trigger('UserPromptSubmit', { messages });
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await model(messages, tools);
    messages.push(response);
    if (response.content) onText(response.content);
    if (!response.tool_calls?.length) {
      const retry = await hooks.trigger('Stop', { messages });
      if (retry) { messages.push({ role: 'user', content: retry }); continue; }
      return response.content ?? '';
    }
    if (response.tool_calls.length > 8) throw new Error('单轮工具调用超过 8 次');
    // 独立工具同轮并行；Promise.all 等待全部完成，按原调用顺序写回结果。
    const results = await Promise.all(response.tool_calls.map(async call => {
      let output: unknown;
      try {
        const blocked = await hooks.trigger('PreToolUse', { messages, call });
        if (blocked) throw new Error(blocked);
        if (!Object.hasOwn(tools, call.function.name)) throw new Error('工具不存在');
        const args = JSON.parse(call.function.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须为对象');
        output = await tools[call.function.name].run(args);
      } catch (error) { output = { error: error instanceof Error ? error.message : String(error) }; }
      await hooks.trigger('PostToolUse', { messages, call, output });
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) } as Message;
    }));
    messages.push(...results);
  }
  throw new Error('达到最大执行轮数（含 Stop hook 续跑），请缩小分析范围后重试');
}
