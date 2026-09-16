import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import type { Model, Message } from '../src/types.js';

// 只在测试中用脚本模型，验证真实 HTTP → loop → 工具 → MD 的完整路径。
const fakeModel: Model = async messages => {
  const outputs = messages.filter(m => m.role === 'tool');
  const call = (name: string, args: object): Message => ({ role: 'assistant', content: `执行 ${name}`, tool_calls: [
    { id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ] });
  if (!outputs.length) return call('overview', { amount: '金额', orderId: '订单号' });
  if (outputs.length === 1) return call('remember', { content: '金额是逐行金额；订单数使用订单号去重。' });
  return { role: 'assistant', content: `合计：${JSON.parse(outputs[0].content!).total}` };
};

test('原生 HTTP 上传两份订单，统计不同，第二次召回 MD；错误文件可重试', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'order-http-'));
  const server = createApp({ model: fakeModel, memoryDir: dir });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    const submit = async (amount: number) => {
      const response = await fetch(`${base}/api/analyze?filename=test.csv`, { method: 'POST', body: `订单号,金额\nA,${amount}` });
      assert.equal(response.status, 200);
      return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    };
    const first = await submit(50); const second = await submit(200);
    assert.equal(first.at(-1).type, 'done'); assert.equal(first.at(-1).data.charts[0].title, '各字段缺失情况'); assert.equal(first.at(-1).text, '合计：50');
    assert.equal(second.at(-1).text, '合计：200');
    assert.ok(second.some(e => e.type === 'memory' && e.text.includes('已召回')));
    assert.equal((await readdir(dir)).filter(f => f.endsWith('.md')).length, 1);
    const invalid = await fetch(`${base}/api/analyze?filename=x.pdf`, { method: 'POST', body: 'bad' });
    assert.equal(invalid.status, 400); assert.match(await invalid.text(), /CSV/);
    const memories = await (await fetch(`${base}/api/memory`)).json(); assert.equal(memories.length, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
