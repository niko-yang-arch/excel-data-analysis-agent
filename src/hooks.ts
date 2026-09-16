import type { Message, ToolCall } from './types.js';

type HookEvent = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';
type HookData = { messages: Message[]; call?: ToolCall; output?: unknown };
type Callback = (data: HookData) => string | void | Promise<string | void>;

// 对应参考文章的三件套：注册表、注册函数、按顺序触发并短路。
export class Hooks {
  private registry = new Map<HookEvent, Callback[]>();
  on(event: HookEvent, callback: Callback) {
    this.registry.set(event, [...(this.registry.get(event) ?? []), callback]);
  }
  async trigger(event: HookEvent, data: HookData): Promise<string | undefined> {
    for (const callback of this.registry.get(event) ?? []) {
      const result = await callback(data);
      if (typeof result === 'string') return result;
    }
  }
}
