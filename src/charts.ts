export type Point = { label: string; value: number };
export type ScatterPoint = { x: number; y: number; label: string };
export type TableData = { columns: string[]; rows: (string | number)[][] };
export type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'table';

// 图型由数据形态决定，不交给模型选：模型只负责决定分析什么。
// id 供模型在报告正文里引用，数值全部来自工具结果，模型无法传入图表数据或代码。
export type Chart = { id: string; title: string; metric: string; note: string } & (
  | { type: 'bar' | 'line'; points: Point[] }
  | { type: 'pie'; points: Point[] }
  | { type: 'scatter'; series: ScatterPoint[]; axes: { x: string; y: string } }
  | { type: 'table'; table: TableData }
);

// 时间序列用折线；少量非负分类的构成用饼图；成对数值用散点；
// 字段与指标清单用表格；其余分类对比用柱状。
export function chartFor(name: string, result: unknown, id: string): Chart | undefined {
  const r = result as Record<string, any>;
  if (!r || r.error) return undefined;
  if (name === 'overview') {
    const columns: string[] = Array.isArray(r.columns) ? r.columns : Object.keys(r.missing ?? {});
    return { id, type: 'table', title: '字段完整性与去重', metric: `${columns.length} 个字段`,
      table: { columns: ['字段', '缺失记录数', '不同取值数'],
        rows: columns.map(column => [column, Number(r.missing?.[column] ?? 0), Number(r.distinct?.[column] ?? 0)]) },
      note: '缺失为 0 表示该列没有空值；不同取值数按非空值去重统计。' };
  }
  if (name === 'statistics' && r.valid > 0) {
    const rows: (string | number)[][] = [];
    for (const [label, value] of [['最小值', r.min], ['均值', r.mean], ['中位数', r.median], ['最大值', r.max],
      ['有效值', r.valid], ['无效值', r.invalid], ['缺失值', r.missing]] as [string, unknown][]) {
      if (typeof value === 'number') rows.push([label, value]);
    }
    if (!rows.length) return undefined;
    return { id, type: 'table', title: `${r.column} · 数值概况`, metric: r.column,
      table: { columns: ['指标', '数值'], rows },
      note: `有效 ${r.valid}，缺失 ${r.missing}，无效 ${r.invalid}；合计不代表该指标适合相加。` };
  }
  if (['group_by', 'trend'].includes(name) && Array.isArray(r.groups)) {
    const valueColumn = r.amount ?? r.valueColumn;
    const metric = valueColumn ? `${valueColumn}合计` : '记录数';
    const points: Point[] = r.groups
      .filter((g: any) => !valueColumn || g.validAmounts > 0)
      .map((g: any) => ({ label: String(g.label), value: valueColumn ? g.total : g.records }))
      .filter((p: Point) => typeof p.value === 'number' && Number.isFinite(p.value));
    if (!points.length) return undefined;
    if (name === 'trend') {
      return { id, type: 'line', title: `${r.dateColumn ?? '日期'} · ${r.period === 'day' ? '每日' : '每月'}${metric}`, metric, points,
        note: `${r.basis ?? ''} 时间按真实日期间隔定位，未出现的日期不补零；悬停查看精确值。` };
    }
    const total = points.reduce((sum, point) => sum + point.value, 0);
    // 组数不多、全部非负且合计为正时才是"构成"，用饼图看占比；否则用柱状图比大小。
    const composition = points.length >= 2 && points.length <= 8 && points.every(point => point.value >= 0) && total > 0;
    const title = `${r.column} · ${metric}`;
    return composition
      ? { id, type: 'pie', title, metric, points,
        note: `${r.basis ?? ''} ${points.length} 组非负数值视为构成${r.groupCount > points.length ? '（仅取前 20 组）' : ''}，饼图显示各自占比，合计 ${total}。` }
      : { id, type: 'bar', title, metric, points,
        note: `${r.basis ?? ''} 含负值或组数较多，柱状图对比大小；无有效数值的组不绘制，悬停查看精确值。` };
  }
  if (name === 'correlate' && Array.isArray(r.pairs)) {
    const series: ScatterPoint[] = r.pairs
      .filter((pair: any) => Number.isFinite(pair.x) && Number.isFinite(pair.y))
      .map((pair: any) => ({ x: Number(pair.x), y: Number(pair.y), label: String(pair.label ?? '') }));
    // 单点无法体现关系，不画散点图。
    if (series.length < 2) return undefined;
    return { id, type: 'scatter', title: `${r.xColumn} × ${r.yColumn}`, metric: '成对数值', series,
      axes: { x: String(r.xColumn), y: String(r.yColumn) },
      note: `${r.basis ?? ''} 展示 ${series.length} 对有效数值${r.count > series.length ? `（共 ${r.count} 对，仅前 ${series.length} 对）` : ''}；点是否沿斜线聚集只描述同向或反向，不代表因果。` };
  }
  if (name === 'repeat_customers' && r.customers > 0) {
    const points = [{ label: '复购客户', value: Number(r.repeatCustomers) },
      { label: '仅一次', value: Number(r.customers) - Number(r.repeatCustomers) }].filter(point => point.value > 0);
    if (!points.length) return undefined;
    const rate = typeof r.repeatRate === 'number' ? `复购率 ${(r.repeatRate * 100).toFixed(1)}%。` : '';
    return { id, type: 'pie', title: '复购与单次客户构成', metric: '客户数', points,
      note: `${rate}只统计本次文件覆盖时间内的独立订单，不等于客户全生命周期复购率。` };
  }
  return undefined;
}
