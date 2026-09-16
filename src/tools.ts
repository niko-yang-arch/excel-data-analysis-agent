import type { Row, Table, Tool, Tools } from './types.js';

// 数值清洗保留负值；缺失和无效值返回 null，不悄悄当成 0。
const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const text = String(value).trim().replace(/[¥￥$,，\s]/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text)) return null;
  const n = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text); return Number.isFinite(n) ? n : null;
};
const round = (n: number) => Number(n.toPrecision(15));
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const day = (v: unknown): string | null => {
  const match = String(v ?? '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

export function makeTools(table: Table, remember: (content: string) => Promise<string>): Tools {
  const { rows, columns } = table;
  const col = (value: unknown, required = false): string | undefined => {
    if (value === undefined && !required) return;
    if (typeof value !== 'string' || !columns.includes(value)) throw new Error(`列不存在：${String(value)}`);
    return value;
  };
  const totals = (data: Row[], amount?: string) => {
    if (!amount) return {};
    const values = data.map(r => numeric(r[amount]));
    return { total: round(values.reduce<number>((sum, n) => sum + (n ?? 0), 0)),
      validAmounts: values.filter(n => n !== null).length, invalidAmounts: values.filter(n => n === null).length };
  };
  const group = (key: (row: Row) => string | null, amount?: string) => {
    const buckets = new Map<string, Row[]>(); let excluded = 0;
    for (const row of rows) {
      const name = key(row); if (name === null) { excluded++; continue; }
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name)!.push(row);
    }
    return { excluded, groups: [...buckets].map(([label, data]) => ({ label, records: data.length, ...totals(data, amount) })) };
  };
  const define = (description: string, fields: Record<string, string>, required: string[], run: Tool['run']): Tool => ({
    description, parameters: { type: 'object', properties: Object.fromEntries(Object.entries(fields).map(([name, description]) => [name, { type: 'string', description }])), required, additionalProperties: false }, run,
  });
  return {
    overview: define('检查任意表格的记录数、列数、重复行、各列缺失；可选指定一个数值列求和。先执行此工具。', { value: '可相加的数值列名，可省略' }, [], async args => {
      const amount = col(args.value ?? args.amount); const orderId = col(args.orderId);
      return { records: rows.length, fieldCount: columns.length, duplicateRows: rows.length - new Set(rows.map(r => JSON.stringify(columns.map(c => r[c])))).size, valueColumn: amount, columns, distinct: Object.fromEntries(columns.map(c => [c, new Set(rows.filter(r => !blank(r[c])).map(r => String(r[c]))).size])), missing: Object.fromEntries(columns.map(c => [c, rows.filter(r => blank(r[c])).length])),
        ...(orderId ? { orders: new Set(rows.filter(r => !blank(r[orderId])).map(r => String(r[orderId]))).size,
          missingOrderIds: rows.filter(r => blank(r[orderId])).length } : {}), ...totals(rows, amount),
        basis: '记录数按行计数；重复行仅提示，不自动删除。total 对指定数值列逐行相加，包含负数，缺失及无效数值排除；不保证该列具有可加性。'  };
    }),
    // 通用数值描述统计，不把数值默认解释为金额，也不对小数强制保留两位。
    statistics: define('计算指定数值列的有效数、缺失数、无效数、合计、均值、中位数与范围。编号不适合统计；百分号按小数比例转换。', { column: '数值列名' }, ['column'], async args => {
      const column = col(args.column, true)!;
      const values = rows.map(r => numeric(r[column])).filter((n): n is number => n !== null).sort((a, b) => a - b);
      const valid = values.length; const missing = rows.filter(r => blank(r[column])).length;
      const total = valid ? round(values.reduce((a, b) => a + b, 0)) : null;
      return { column, valid, missing, invalid: rows.length - valid - missing, total,
        mean: valid ? round(total! / valid) : null,
        median: valid ? round((values[Math.floor((valid - 1) / 2)] + values[Math.floor(valid / 2)]) / 2) : null,
        min: values[0] ?? null, max: values.at(-1) ?? null,
        basis: '缺失和非数值不参与计算；百分号转为小数。合计不代表该指标适合相加，解释需结合业务含义和单位。' };
    }),
    group_by: define('按任意分类列统计频次，或对指定数值列求和，输出前 20 组。默认按频次降序，指定 value 时按合计降序。', { column: '分类列名', value: '可相加的数值列名，可省略' }, ['column'], async args => {
      const column = col(args.column, true)!; const amount = col(args.value ?? args.amount);
      const result = group(r => blank(r[column]) ? '（空值）' : String(r[column]), amount);
      result.groups.sort((a, b) => amount ? (b.total ?? 0) - (a.total ?? 0) : b.records - a.records);
      return { column, amount, groupCount: result.groups.length, groups: result.groups.slice(0, 20), basis: '前 20 组；records 是明细行数，total 是指定数值列按行求和。' };
    }),
    trend: define('按日或月汇总，日期必须为 YYYY-MM-DD 或 YYYY/MM/DD，可带时间。排除无效日期，最多返回最近 60 期。', { date: '日期列名', value: '可相加的数值列名，可省略', period: 'day 或 month，默认 month' }, ['date'], async args => {
      const date = col(args.date, true)!; const amount = col(args.value ?? args.amount);
      const period = args.period ?? 'month';
      if (!['day', 'month'].includes(String(period))) throw new Error('period 必须为 day 或 month');
      const result = group(r => { const parsed = day(r[date]); return parsed ? parsed.slice(0, period === 'month' ? 7 : 10) : null; }, amount);
      result.groups.sort((a, b) => a.label.localeCompare(b.label));
      return { dateColumn: date, valueColumn: amount, period, invalidDates: result.excluded, periodCount: result.groups.length, groups: result.groups.slice(-60), basis: '仅列出有记录的最近 60 期，缺失日期不自动补零。records 为明细行数。' };
    }),
    repeat_customers: define('仅在明确是客户订单数据时使用：按客户独立订单数计算复购。至少两单视为复购；不输出客户身份。', { customer: '客户标识列名', orderId: '订单编号列名' }, ['customer', 'orderId'], async args => {
      const customer = col(args.customer, true)!; const orderId = col(args.orderId, true)!;
      const customers = new Map<string, Set<string>>(); let excludedRows = 0;
      for (const r of rows) {
        if (blank(r[customer]) || blank(r[orderId])) { excludedRows++; continue; }
        const key = String(r[customer]); if (!customers.has(key)) customers.set(key, new Set());
        customers.get(key)!.add(String(r[orderId]));
      }
      const repeatCustomers = [...customers.values()].filter(orders => orders.size > 1).length;
      return { customers: customers.size, repeatCustomers, repeatRate: customers.size ? repeatCustomers / customers.size : null, excludedRows, basis: '仅基于本次文件覆盖时间内的独立订单；不等于客户全生命周期复购率。' };
    }),
    remember: define('在分析后保存可复用经验。只记字段含义、方法与口径提醒，不保存个人身份、原始记录和历史数值；结合旧经验修订。', { content: '简短 Markdown 经验，最多 3000 字' }, ['content'], async args => {
      if (typeof args.content !== 'string') throw new Error('content 必须为文本');
      return { file: await remember(args.content), content: args.content };
    }),
  };
}
