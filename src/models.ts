import type { Message, Model } from './types.js';

// MiniMax 等模型会把推理过程以 <think>…</think> 直接混在 content 里（而不是 reasoning_content），
// 这里统一剥离，只保留面向用户的公开文本；推理被截断时丢弃未闭合的尾巴。
function publicText(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  return content
    .replace(/<think(?:ing)?\s*>[\s\S]*?<\/think(?:ing)?\s*>/gi, '')
    .replace(/<think(?:ing)?\s*>[\s\S]*$/i, '')
    .trim() || null;
}

// 不引入 SDK 或 agent 框架，原生 fetch 返回 Promise，await 等待模型响应。
export function createModel(signal?: AbortSignal): Model {
  const { MODEL_API_KEY: key, MODEL_NAME: model, MODEL_BASE_URL: base = 'https://api.openai.com/v1' } = process.env;
  if (!key || !model) throw new Error('请在工程 .env 中配置 MODEL_API_KEY 和 MODEL_NAME，再重启服务');
  // 原始回复仅留在后端供模型续轮使用；UI 接收的仍是公开摘要。
  const originals = new WeakMap<Message, unknown>();
  return async (messages, tools) => {
    const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])]),
      body: JSON.stringify({ model, messages: messages.map(m => originals.get(m) ?? m), tools: Object.entries(tools).map(([name, tool]) => ({
        type: 'function', function: { name, description: tool.description, parameters: tool.parameters },
      })) }),
    });
    if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}，请检查模型名称、密钥、额度及 tools 支持情况`);
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const text = publicText(message?.content);
    if (!message || (!text && !message.tool_calls?.length)) throw new Error('模型未返回有效文本或工具调用');
    // 仅取标准公开消息，不读取或展示 reasoning_content 等内部推理字段。
    const result: Message = { role: 'assistant', content: text, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) };
    originals.set(result, message);
    return result;
  };
}
