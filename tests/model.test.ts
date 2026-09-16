import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createModel } from '../src/models.js';
import { makeTools } from '../src/tools.js';

test('模型适配器发送标准 tools/messages，只返回公开内容，不泄露上游错误正文', async () => {
  const keys = ['MODEL_API_KEY', 'MODEL_BASE_URL', 'MODEL_NAME'] as const;
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  let requests = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(body.messages[0].content, '分析当前订单');
    assert.ok(body.tools.some((t: any) => t.function.name === 'overview'));
    res.setHeader('Content-Type', 'application/json');
    if (requests++ > 0) { res.writeHead(401); res.end('private upstream error'); return; }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '简短公开摘要', reasoning_content: '内部内容' } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.MODEL_API_KEY = 'test-only'; process.env.MODEL_NAME = 'test-only';
    process.env.MODEL_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    const model = createModel(); const tools = makeTools({ columns: ['金额'], rows: [{ 金额: 1 }], sheet: 'test' }, async () => '');
    const messages = [{ role: 'user' as const, content: '分析当前订单' }];
    assert.deepEqual(await model(messages, tools), { role: 'assistant', content: '简短公开摘要' });
    await assert.rejects(model(messages, tools), /HTTP 401/);
  } finally {
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('适配器剥离混在 content 里的 <think> 推理，只把公开文本交给用户', async () => {
  const keys = ['MODEL_API_KEY', 'MODEL_BASE_URL', 'MODEL_NAME'] as const;
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  let sentContent: unknown;
  const replies = [
    { role: 'assistant', content: '<think>\n先看金额。\n</think>\n\n订单 A1001 已发货。' },
    { role: 'assistant', content: '<think>\n只需要调用工具。\n</think>\n\n', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'overview', arguments: '{}' } }] },
    { role: 'assistant', content: '<think>\n推理被 max_tokens 截断' },
  ];
  let requests = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (requests === 1) sentContent = body.messages.at(-1).content;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: replies[requests++] }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.MODEL_API_KEY = 'test-only'; process.env.MODEL_NAME = 'test-only';
    process.env.MODEL_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    const model = createModel(); const tools = makeTools({ columns: ['金额'], rows: [{ 金额: 1 }], sheet: 'test' }, async () => '');
    const messages = [{ role: 'user' as const, content: '分析当前订单' }];
    const first = await model(messages, tools);
    assert.deepEqual(first, { role: 'assistant', content: '订单 A1001 已发货。' });
    assert.deepEqual(await model([...messages, first], tools), { ...replies[1], content: null });
    assert.equal(sentContent, replies[0].content);
    await assert.rejects(model(messages, tools), /未返回有效文本或工具调用/);
  } finally {
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
