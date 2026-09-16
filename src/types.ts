export type Row = Record<string, string | number | boolean | null>;
export type Table = { columns: string[]; rows: Row[]; sheet: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null;
  tool_calls?: ToolCall[]; tool_call_id?: string;
};
export type Tool = {
  description: string; parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};
export type Tools = Record<string, Tool>;
export type Model = (messages: Message[], tools: Tools) => Promise<Message>;
export type Event = { type: string; text: string; data?: unknown };
export type Emit = (event: Event) => void;
