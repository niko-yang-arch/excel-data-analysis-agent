import test from 'node:test';
import assert from 'node:assert/strict';
import { chartFor } from '../src/charts.js';
import { chartSvg } from '../public/charts.js';

test('分类结果：少量非负构成用饼图，含负值或单组用柱状图', () => {
  const pie = chartFor('group_by', { column: '部门', amount: '得分', groupCount: 2, groups: [
    { label: 'A', records: 2, total: 30, validAmounts: 2 },
    { label: 'B', records: 1, total: 20, validAmounts: 1 },
  ], basis: '前 20 组' }, 'fig-1');
  assert.ok(pie && pie.type === 'pie');
  assert.equal(pie.id, 'fig-1');
  assert.deepEqual(pie.points, [{ label: 'A', value: 30 }, { label: 'B', value: 20 }]);
  assert.match(pie.note, /占比/);

  const bar = chartFor('group_by', { column: '类别', amount: '数值', groups: [
    { label: 'A', records: 2, total: -5, validAmounts: 2 },
    { label: 'B', records: 1, total: 0, validAmounts: 0 },
  ], basis: '前20组' }, 'fig-1');
  assert.ok(bar && bar.type === 'bar');
  assert.deepEqual(bar.points, [{ label: 'A', value: -5 }]);
  assert.match(bar.note, /前20组/);
});

test('时间序列用折线，复购与未复购构成用饼图', () => {
  const trend = chartFor('trend', { dateColumn: '日期', period: 'month', groups: [
    { label: '2026-01', records: 2 }, { label: '2026-03', records: 4 },
  ] }, 'fig-2');
  assert.ok(trend && trend.type === 'line');
  assert.equal(trend.points.length, 2);

  const repeat = chartFor('repeat_customers', { customers: 10, repeatCustomers: 4, repeatRate: 0.4 }, 'fig-3');
  assert.ok(repeat && repeat.type === 'pie');
  assert.deepEqual(repeat.points, [{ label: '复购客户', value: 4 }, { label: '仅一次', value: 6 }]);
  assert.match(repeat.note, /40\.0%/);
});

test('清单类结果用表格，成对数值用散点，无法成图时返回 undefined', () => {
  const overview = chartFor('overview', { columns: ['名称', '数量'], missing: { 名称: 0, 数量: 2 }, distinct: { 名称: 3, 数量: 2 } }, 'fig-1');
  assert.ok(overview && overview.type === 'table');
  assert.deepEqual(overview.table.columns, ['字段', '缺失记录数', '不同取值数']);
  assert.deepEqual(overview.table.rows, [['名称', 0, 3], ['数量', 2, 2]]);

  const statistics = chartFor('statistics', { column: '得分', valid: 5, missing: 1, invalid: 0, min: 1, mean: 2, median: 2, max: 3 }, 'fig-2');
  assert.ok(statistics && statistics.type === 'table');
  assert.ok(statistics.table.rows.some(row => row[0] === '中位数'));
  assert.match(statistics.note, /有效 5/);

  const scatter = chartFor('correlate', { xColumn: '身高', yColumn: '体重', count: 2, skipped: 1, pairs: [
    { x: 1, y: 2, label: '第 2 行' }, { x: 2, y: 4, label: '第 3 行' }, { x: 3, y: '无效', label: '第 4 行' },
  ], basis: '只使用两列都有有效数值的行' }, 'fig-3');
  assert.ok(scatter && scatter.type === 'scatter');
  assert.equal(scatter.series.length, 2);
  assert.deepEqual(scatter.axes, { x: '身高', y: '体重' });

  assert.equal(chartFor('statistics', { column: '得分', valid: 0 }, 'fig-4'), undefined);
  assert.equal(chartFor('correlate', { xColumn: 'a', yColumn: 'b', pairs: [{ x: 1, y: 1, label: '' }] }, 'fig-5'), undefined);
  assert.equal(chartFor('remember', { file: 'a.md' }, 'fig-6'), undefined);
});

test('SVG 覆盖柱状、折线、饼图与散点，正确处理零、负数和单点，不插入用户 HTML', () => {
  const bar = chartSvg({ id: 'fig-1', type: 'bar', title: '<script>alert(1)</script>', metric: '记录数', note: '',
    points: [{ label: '<img onerror=x>', value: -5 }, { label: '零', value: 0 }] });
  assert.ok(bar.includes('&lt;script&gt;')); assert.ok(!bar.includes('<script>')); assert.ok(!bar.includes('<img'));
  assert.ok(!/NaN|Infinity/.test(bar));

  const line = chartSvg({ id: 'fig-2', type: 'line', title: '趋势', metric: '记录数', note: '', points: [{ label: '2026-01', value: 0 }] });
  assert.match(line, /<circle/); assert.ok(!/NaN|Infinity/.test(line));

  const pie = chartSvg({ id: 'fig-3', type: 'pie', title: '构成', metric: '客户数', note: '',
    points: [{ label: '甲', value: 3 }, { label: '乙', value: 1 }] });
  assert.ok(pie.includes('<path')); assert.ok(!/NaN|Infinity/.test(pie));

  const single = chartSvg({ id: 'fig-4', type: 'pie', title: '单一构成', metric: '客户数', note: '', points: [{ label: '甲', value: 5 }] });
  assert.ok(single.includes('<circle')); assert.ok(!/NaN|Infinity/.test(single));

  const scatter = chartSvg({ id: 'fig-5', type: 'scatter', title: '两列关系', metric: '成对数值', note: '', axes: { x: 'a', y: 'b' },
    series: [{ x: 1, y: 2, label: '第 2 行' }, { x: 2, y: 2, label: '第 3 行' }] });
  assert.ok(scatter.includes('<circle')); assert.ok(!/NaN|Infinity/.test(scatter));

  assert.equal(chartSvg({ id: 'fig-6', type: 'table', title: '字段', metric: '2 个字段', note: '', table: { columns: ['a'], rows: [[1]] } }), '');
});
