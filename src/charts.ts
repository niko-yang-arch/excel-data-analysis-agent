export type Chart = { type: 'bar' | 'line'; title: string; metric: string; note: string; points: { label: string; value: number }[] };

// 图表只消费本次工具计算结果，模型不能传入任意图表数值或可执行代码。
export function chartFor(name: string, result: unknown): Chart | undefined {
  const r = result as Record<string, any>;
  if (!r || r.error) return;
  let title: string; let metric: string; let points: Chart['points'];
  if (name === 'overview') {
    title = '各字段缺失情况'; metric = '缺失记录数';
    points = Object.entries(r.missing ?? {}).map(([label, value]) => ({ label, value: Number(value) })).sort((a, b) => b.value - a.value).slice(0, 20);
  } else if (name === 'statistics' && r.valid > 0) {
    title = `${r.column} · 数值概况`; metric = r.column;
    points = [['min','最小值'],['mean','均值'],['median','中位数'],['max','最大值']].map(([key, label]) => ({ label, value: r[key] }));
  } else if (['group_by', 'trend'].includes(name) && Array.isArray(r.groups)) {
    const valueColumn = r.amount ?? r.valueColumn;
    metric = valueColumn ? `${valueColumn}合计` : '记录数';
    title = name === 'trend' ? `${r.dateColumn ?? '日期'} · ${r.period === 'day' ? '每日' : '每月'}${metric}` : `${r.column} · ${metric}`;
    points = r.groups.filter((g: any) => !valueColumn || g.validAmounts > 0).map((g: any) => ({ label: String(g.label), value: valueColumn ? g.total : g.records }));
  } else return;
  points = points.filter(p => typeof p.value === 'number' && Number.isFinite(p.value));
  if (!points.length) return;
  return { type: name === 'trend' ? 'line' : 'bar', title, metric, points,
    note: name === 'overview' ? '按缺失数降序，最多展示 20 列；零表示没有缺失。' : `${r.basis ?? ''} ${name === 'statistics' ? `有效 ${r.valid}，缺失 ${r.missing}，无效 ${r.invalid}。` : '无有效数值的组不绘制；悬停查看精确值。'}` };
}
