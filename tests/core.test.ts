import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseTable, stripNamespacePrefixes } from '../src/context.js';
import { makeTools } from '../src/tools.js';
import { Hooks } from '../src/hooks.js';
import { agentLoop } from '../src/agent.js';
import { loadMemory, saveMemory } from '../src/memory.js';
import type { Message, Model, Table } from '../src/types.js';

const table: Table = {
  columns: ['订单号', '金额', '地区', '日期', '客户'], sheet: 'CSV',
  rows: [
    { 订单号: 'A', 金额: '￥1,200.50', 地区: '上海', 日期: '2026-09-01', 客户: '甲' },
    { 订单号: 'A', 金额: 100, 地区: '上海', 日期: '2026-09-02', 客户: '甲' },
    { 订单号: 'B', 金额: -20, 地区: '北京', 日期: '2026-09-02', 客户: '甲' },
    { 订单号: 'C', 金额: '无效', 地区: '北京', 日期: '2026-02-30', 客户: '乙' },
  ],
};
const tools = makeTools(table, async () => 'memory/test.md');
const run = (name: string, args = {}) => tools[name].run(args) as Promise<any>;

test('CSV 数据来自当前文件，保留带引号的逗号，拒绝重复列名', async () => {
  const parsed = await parseTable(Buffer.from('\uFEFF订单号,金额\nA,"1,200"\nB,300'), 'orders.csv');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]['金额'], '1,200');
  await assert.rejects(parseTable(Buffer.from('金额,金额\n1,2'), 'bad.csv'), /重复/);
  await assert.rejects(parseTable(Buffer.from('金额\n'), 'empty.csv'), /数据/);
  await assert.rejects(parseTable(Buffer.from('hello'), 'bad.pdf'), /CSV.*XLSX/);
});

test('XLSX 读取首个非空工作表，日期与公式缓存值可分析', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('空表');
  const sheet = wb.addWorksheet('订单');
  sheet.addRow(['日期', '金额']); sheet.addRow([new Date('2026-09-01T00:00:00Z'), { formula: '2*50', result: 100 }]);
  const parsed = await parseTable(Buffer.from(await wb.xlsx.writeBuffer()), 'orders.xlsx');
  assert.equal(parsed.sheet, '订单');
  assert.equal(parsed.rows[0]['金额'], 100);
  assert.equal(parsed.rows[0]['日期'], '2026-09-01');
});

// 模拟部分导出工具的写法：把电子表格主命名空间从默认声明改成带前缀声明。
async function withNamespacePrefixes(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^xl\/.*\.xml$/i.test(name)) continue;
    let xml = await entry.async('string');
    if (!xml.includes('http://schemas.openxmlformats.org/spreadsheetml/2006/main')) continue;
    xml = xml
      .replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
      .replace(/<(\/?)([A-Za-z_][\w.-]*)([\s/>])/g, (match, slash, tag, tail) => `<${slash}x:${tag}${tail}`);
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('XLSX 标签带命名空间前缀时仍可解析，正常文件不被改写', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('订单');
  sheet.addRow(['订单号', '金额']); sheet.addRow(['甲', 100]);
  const original = Buffer.from(await wb.xlsx.writeBuffer());
  const prefixed = await withNamespacePrefixes(original);
  const zip = await JSZip.loadAsync(prefixed);
  assert.ok((await zip.file('xl/workbook.xml')!.async('string')).includes('<x:workbook'));
  const parsed = await parseTable(prefixed, 'orders.xlsx');
  assert.equal(parsed.sheet, '订单');
  assert.deepEqual(parsed.columns, ['订单号', '金额']);
  assert.equal(parsed.rows[0]['金额'], 100);
  // 没有前缀的文件不进入归一化分支，保持逐字节原样
  assert.equal(await stripNamespacePrefixes(original), null);
});

test('概览按行求和但按订单号去重，金额无效值不变成 0', async () => {
  const result = await run('overview', { amount: '金额', orderId: '订单号' });
  assert.equal(result.records, 4);
  assert.equal(result.orders, 3);
  assert.equal(result.total, 1280.5);
  assert.equal(result.invalidAmounts, 1);
  assert.equal(result.averageOrderAmount, undefined); // 存在无效金额时不声称客单价完整
});

test('更换数据集后统计完全改变，不带入旧订单', async () => {
  const changed = makeTools({ ...table, rows: [{ 金额: 7 }] }, async () => '');
  const result = await changed.overview.run({ amount: '金额' }) as any;
  assert.equal(result.total, 7); assert.equal(result.records, 1); assert.equal(result.orders, undefined);
});

test('分组与趋势使用实际列，异常日期单独计数', async () => {
  const grouped = await run('group_by', { column: '地区', amount: '金额' });
  assert.equal(grouped.groups[0].label, '上海');
  assert.equal(grouped.groups[0].total, 1300.5);
  const trend = await run('trend', { date: '日期', amount: '金额', period: 'day' });
  assert.equal(trend.invalidDates, 1);
  assert.deepEqual(trend.groups.map((x: any) => x.label), ['2026-09-01', '2026-09-02']);
  await assert.rejects(run('group_by', { column: '不存在' }), /不存在/);
});

test('复购按独立订单计算，重复行不是重复购买', async () => {
  const result = await run('repeat_customers', { customer: '客户', orderId: '订单号' });
  assert.equal(result.customers, 2); assert.equal(result.repeatCustomers, 1); assert.equal(result.repeatRate, 0.5);
});

test('hook 按注册顺序执行并通过字符串短路', async () => {
  const hooks = new Hooks(); const calls: number[] = [];
  hooks.on('PreToolUse', async () => { calls.push(1); return '拒绝'; });
  hooks.on('PreToolUse', () => { calls.push(2); });
  assert.equal(await hooks.trigger('PreToolUse', { messages: [] }), '拒绝');
  assert.deepEqual(calls, [1]);
});

test('agent loop 等待并行工具，将结果回填给模型，再结束', async () => {
  const messages: Message[] = []; let turns = 0;
  const model: Model = async history => {
    if (turns++ === 0) return { role: 'assistant', content: '先检查数据概览。', tool_calls: [
      { id: '1', type: 'function', function: { name: 'overview', arguments: '{"amount":"金额"}' } },
      { id: '2', type: 'function', function: { name: 'group_by', arguments: '{"column":"地区"}' } },
    ] };
    const outputs = history.filter(m => m.role === 'tool');
    assert.equal(outputs.length, 2);
    assert.equal(JSON.parse(outputs[0].content!).total, 1280.5);
    return { role: 'assistant', content: '已完成分析。' };
  };
  const events: string[] = []; const hooks = new Hooks();
  hooks.on('PreToolUse', () => { events.push('pre'); });
  hooks.on('PostToolUse', () => { events.push('post'); });
  assert.equal(await agentLoop({ messages, tools, model, hooks }), '已完成分析。');
  assert.equal(turns, 2); assert.equal(events.filter(x => x === 'post').length, 2);
});

test('工具错误交还模型自纠；Stop hook 能阻止过早完成', async () => {
  const hooks = new Hooks(); let stops = 0; let turns = 0;
  hooks.on('Stop', () => ++stops === 1 ? '请补充检查' : undefined);
  const model: Model = async history => {
    turns++;
    if (turns === 1) return { role: 'assistant', content: null, tool_calls: [
      { id: 'bad', type: 'function', function: { name: 'unknown', arguments: '{}' } },
    ] };
    if (turns === 2) assert.match(history.at(-1)!.content!, /error/);
    return { role: 'assistant', content: '完成' };
  };
  assert.equal(await agentLoop({ messages: [], tools, hooks, model }), '完成');
  assert.equal(turns, 3);
});

test('不终止的模型受到最大轮数限制', async () => {
  const hooks = new Hooks(); hooks.on('Stop', () => '继续');
  await assert.rejects(agentLoop({ messages: [], tools, hooks, maxTurns: 2,
    model: async () => ({ role: 'assistant', content: '结束' }) }), /轮数/);
});

test('记忆保存为 MD，同结构下次召回，不同结构隔离', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'order-memory-'));
  try {
    assert.equal(await loadMemory(table.columns, dir), '');
    await saveMemory(table.columns, '按订单号去重统计订单数，金额按明细行求和。', dir);
    const files = await readdir(dir); assert.equal(files.length, 1); assert.ok(files[0].endsWith('.md'));
    assert.match(await readFile(join(dir, files[0]), 'utf8'), /按订单号/);
    assert.match(await loadMemory([...table.columns].reverse(), dir), /按订单号/);
    assert.equal(await loadMemory(['其他格式'], dir), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('通用表格概览不要求订单字段，数值统计保留精度并排除缺失', async () => {
  const generic = makeTools({ columns: ['部门', '得分'], sheet: '成绩', rows: [
    { 部门: '研发', 得分: 80 }, { 部门: '研发', 得分: 100 },
    { 部门: '销售', 得分: null }, { 部门: '销售', 得分: '缺考' },
  ] }, async () => '');
  const overview = await generic.overview.run({}) as any;
  assert.equal(overview.fieldCount, 2); assert.equal(overview.orders, undefined);
  const stats = await generic.statistics.run({ column: '得分' }) as any;
  assert.equal(stats.valid, 2); assert.equal(stats.missing, 1); assert.equal(stats.invalid, 1);
  assert.equal(stats.mean, 90); assert.equal(stats.median, 90); assert.equal(stats.min, 80); assert.equal(stats.max, 100);
  const groups = await generic.group_by.run({ column: '部门', value: '得分' }) as any;
  assert.equal(groups.groups[0].total, 180);
  const tiny = makeTools({columns:['测量值'],sheet:'测量',rows:[{测量值:'1e-5'},{测量值:'2e-5'}]}, async()=> '');
  assert.equal((await tiny.statistics.run({column:'测量值'}) as any).total, 0.00003);
});
