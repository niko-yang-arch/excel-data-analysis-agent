import test from 'node:test';
import assert from 'node:assert/strict';
import { chartFor } from '../src/charts.js';
import { chartSvg } from '../public/charts.js';

test('图表来自计算结果，分组保留负值，无效值不伪装成零', () => {
  const chart = chartFor('group_by', { column: '类别', amount: '数值', groups: [
    { label: 'A', records: 2, total: -5, validAmounts: 2 },
    { label: 'B', records: 1, total: 0, validAmounts: 0 },
  ], basis: '前20组' })!;
  assert.equal(chart.type, 'bar'); assert.deepEqual(chart.points, [{ label: 'A', value: -5 }]);
  assert.match(chart.note, /前20组/);
  assert.equal(chartFor('statistics', { column: '数值', valid: 0, min: null, max: null }), undefined);
});

test('日期结果生成折线图，基础概览也能生成缺失情况图', () => {
  assert.equal(chartFor('trend', { period:'month',groups:[{label:'2026-01',records:2},{label:'2026-03',records:4}] })?.type, 'line');
  assert.equal(chartFor('overview', { missing:{名称:0,数量:2} })?.points.find(p => p.label === '数量')?.value, 2);
});

test('SVG 正确处理零、负数和单点，不插入用户 HTML', () => {
  const svg = chartSvg({ type:'bar',title:'<script>alert(1)</script>',metric:'记录数',note:'',points:[{label:'<img onerror=x>',value:-5},{label:'零',value:0}] });
  assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('<img'));
  assert.ok(!/NaN|Infinity/.test(svg));
  const line = chartSvg({type:'line',title:'趋势',metric:'记录数',note:'',points:[{label:'2026-01',value:0}]});
  assert.ok(!/NaN|Infinity/.test(line)); assert.match(line, /<circle/);
});
