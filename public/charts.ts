import type { Chart } from '../src/charts.js';
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number = (n: number) => n.toLocaleString('zh-CN', { maximumSignificantDigits: 8 });
const round = (n: number) => Number(n.toFixed(2));
const short = (label: string) => label.length > 16 ? `${label.slice(0, 16)}…` : label;
const text = (x: number, y: number, label: string, anchor = 'start') => `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" fill="#697b96" font-size="11">${escape(label)}</text>`;
const frame = (width: number, height: number, title: string, metric: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}" style="font-family:system-ui,sans-serif;background:white"><title>${escape(title)} · ${escape(metric)}</title>${body}</svg>`;

// 原生 SVG 绘图：保留零基线和负值，日期按真实时间间隔定位；文本一律转义。表格由表格渲染承担。
export function chartSvg(chart: Chart): string {
  if (chart.type === 'table') return '';
  if (chart.type === 'scatter') return scatterSvg(chart);
  if (chart.type === 'pie') return pieSvg(chart);
  return categorySvg(chart);
}

// 柱状图与折线图：分类对比和带真实时间间隔的时间序列。
function categorySvg(chart: Extract<Chart, { type: 'bar' | 'line' }>): string {
  const points = chart.points.filter(p => Number.isFinite(p.value));
  const line = chart.type === 'line'; const width = 700; const height = line ? 280 : Math.max(160, points.length * 30 + 55);
  const left = line ? 85 : 165; const right = 600; const top = 25; const bottom = height - 40;
  const min = Math.min(0, ...points.map(p => p.value)); const max = Math.max(0, ...points.map(p => p.value));
  const span = max - min || 1; const scale = (v: number) => (v - min) / span;
  const xValue = (v: number) => left + scale(v) * (right - left);
  const yValue = (v: number) => bottom - scale(v) * (bottom - top);
  let body = '';
  for (let i = 0; i <= 4; i++) {
    const value = min + (max === min ? 1 : span) * i / 4;
    const pos = line ? bottom - i / 4 * (bottom - top) : left + i / 4 * (right - left);
    body += line ? `<path d="M${left},${pos}H${right}" stroke="#e8edf5"/>${text(left-10,pos+4,number(value),'end')}`
      : `<path d="M${pos},${top-10}V${bottom}" stroke="#e8edf5"/>${text(pos,height-12,number(value),'middle')}`;
  }
  if (line) {
    const times = points.map(p => Date.parse(p.label.length === 7 ? `${p.label}-01T00:00:00Z` : `${p.label}T00:00:00Z`));
    const dated = times.every(Number.isFinite); const range = times.at(-1)! - times[0];
    const x = (i: number) => points.length === 1 ? (left + right) / 2 : left + (dated && range > 0 ? (times[i] - times[0]) / range : i / (points.length - 1)) * (right - left);
    body += `<path d="M${left},${yValue(0)}H${right}" stroke="#9cacbf"/><polyline fill="none" stroke="#2b57db" stroke-width="2" points="${points.map((p,i) => `${x(i)},${yValue(p.value)}`).join(' ')}"/>`;
    let lastLabel = -Infinity;
    points.forEach((p, i) => {
      body += `<circle cx="${x(i)}" cy="${yValue(p.value)}" r="4" fill="#2b57db"><title>${escape(p.label)}：${escape(p.value)}</title></circle>`;
      if (x(i) - lastLabel >= 90 && (i === points.length - 1 || x(points.length - 1) - x(i) >= 90)) {
        body += text(x(i), height - 12, p.label, 'middle'); lastLabel = x(i);
      }
    });
  } else {
    body += `<path d="M${xValue(0)},${top-10}V${bottom}" stroke="#9cacbf"/>`;
    points.forEach((p, i) => {
      const y = top + i * 30;
      body += text(left - 10, y + 13, short(p.label), 'end');
      body += `<rect x="${Math.min(xValue(0), xValue(p.value))}" y="${y}" width="${Math.abs(xValue(p.value)-xValue(0))}" height="18" rx="3" fill="${p.value < 0 ? '#bb7055' : '#5074db'}"><title>${escape(p.label)}：${escape(p.value)}</title></rect>`;
      body += text(right + 12, y + 13, number(p.value));
    });
  }
  return frame(width, height, chart.title, chart.metric, body);
}

// 饼图：非负构成占比。单组或全零时退化为完整圆形，避免画出零面积扇形。
function pieSvg(chart: Extract<Chart, { type: 'pie' }>): string {
  const points = chart.points.filter(p => Number.isFinite(p.value) && p.value >= 0);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const width = 700; const height = Math.max(230, points.length * 26 + 70);
  const radius = Math.min(105, height / 2 - 45); const cx = 175; const cy = height / 2 - 6;
  const palette = ['#2b57db', '#4f7ce8', '#7ba0f0', '#a6c0f7', '#c9a227', '#bb7055', '#5f9e8a', '#8b7fd1'];
  let body = ''; let angle = -Math.PI / 2;
  points.forEach((p, i) => {
    const color = palette[i % palette.length];
    const share = total > 0 ? p.value / total : 0;
    const percent = (share * 100).toFixed(1);
    const tip = `<title>${escape(p.label)}：${escape(p.value)}（${percent}%）</title>`;
    if (points.length === 1 || total <= 0 || share >= 1) {
      body += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}">${tip}</circle>`;
    } else {
      const x1 = cx + Math.cos(angle) * radius; const y1 = cy + Math.sin(angle) * radius;
      angle += share * Math.PI * 2;
      const x2 = cx + Math.cos(angle) * radius; const y2 = cy + Math.sin(angle) * radius;
      body += `<path d="M${cx},${cy}L${round(x1)},${round(y1)}A${radius},${radius} 0 ${share > 0.5 ? 1 : 0} 1 ${round(x2)},${round(y2)}Z" fill="${color}" stroke="white">${tip}</path>`;
    }
    const y = 34 + i * 26;
    body += `<rect x="330" y="${y - 9}" width="12" height="12" rx="3" fill="${color}"/>${text(350, y + 1, `${short(p.label)}  ${number(p.value)}（${percent}%）`)}`;
  });
  return frame(width, height, chart.title, chart.metric, body);
}

// 散点图：两列数值的成对关系。点沿斜线聚集只说明同向或反向，不表示因果。
function scatterSvg(chart: Extract<Chart, { type: 'scatter' }>): string {
  const series = chart.series.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const width = 700; const height = 320; const left = 80; const right = width - 34; const top = 30; const bottom = height - 52;
  const spread = (min: number, max: number) => { const span = max - min || Math.abs(max) || 1; return [min - span * 0.06, max + span * 0.06]; };
  const [xMin, xMax] = spread(Math.min(...series.map(p => p.x)), Math.max(...series.map(p => p.x)));
  const [yMin, yMax] = spread(Math.min(...series.map(p => p.y)), Math.max(...series.map(p => p.y)));
  const px = (v: number) => left + (v - xMin) / (xMax - xMin) * (right - left);
  const py = (v: number) => bottom - (v - yMin) / (yMax - yMin) * (bottom - top);
  let body = '';
  for (let i = 0; i <= 4; i++) {
    const y = round(bottom - i / 4 * (bottom - top)); const x = round(left + i / 4 * (right - left));
    body += `<path d="M${left},${y}H${right}" stroke="#e8edf5"/>${text(left - 8, y + 4, number(yMin + (yMax - yMin) * i / 4), 'end')}`;
    body += `<path d="M${x},${top}V${bottom}" stroke="#f1f4f9"/>${text(x, height - 34, number(xMin + (xMax - xMin) * i / 4), 'middle')}`;
  }
  body += `<path d="M${left},${top}V${bottom}H${right}" fill="none" stroke="#9cacbf"/>`;
  for (const p of series) {
    body += `<circle cx="${round(px(p.x))}" cy="${round(py(p.y))}" r="4" fill="#2b57db" fill-opacity="0.7"><title>${escape(p.label)}：${escape(chart.axes.x)}=${escape(p.x)}，${escape(chart.axes.y)}=${escape(p.y)}</title></circle>`;
  }
  body += text((left + right) / 2, height - 12, chart.axes.x, 'middle') + text(left - 8, top - 12, chart.axes.y);
  return frame(width, height, chart.title, chart.metric, body);
}

export function downloadSvg(chart: Chart) {
  if (chart.type === 'table') return;
  const url = URL.createObjectURL(new Blob([chartSvg(chart)], {type:'image/svg+xml;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url;
  link.download = `${chart.title.replace(/[\\/:*?"<>|]/g, '_')}.svg`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
