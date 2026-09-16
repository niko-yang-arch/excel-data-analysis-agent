import type { Chart } from '../src/charts.js';
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number = (n: number) => n.toLocaleString('zh-CN', { maximumSignificantDigits: 8 });

// 原生 SVG 绘图：保留零基线和负值，日期按真实时间间隔定位；文本一律转义。
export function chartSvg(chart: Chart): string {
  const points = chart.points.filter(p => Number.isFinite(p.value));
  const line = chart.type === 'line'; const width = 700; const height = line ? 280 : Math.max(160, points.length * 30 + 55);
  const left = line ? 85 : 165; const right = 600; const top = 25; const bottom = height - 40;
  const min = Math.min(0, ...points.map(p => p.value)); const max = Math.max(0, ...points.map(p => p.value));
  const span = max - min || 1; const scale = (v: number) => (v - min) / span;
  const xValue = (v: number) => left + scale(v) * (right - left);
  const yValue = (v: number) => bottom - scale(v) * (bottom - top);
  const text = (x: number, y: number, label: string, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#697b96" font-size="11">${escape(label)}</text>`;
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
      body += text(left - 10, y + 13, p.label.length > 15 ? p.label.slice(0, 15) + '…' : p.label, 'end');
      body += `<rect x="${Math.min(xValue(0), xValue(p.value))}" y="${y}" width="${Math.abs(xValue(p.value)-xValue(0))}" height="18" rx="3" fill="${p.value < 0 ? '#bb7055' : '#5074db'}"><title>${escape(p.label)}：${escape(p.value)}</title></rect>`;
      body += text(right + 12, y + 13, number(p.value));
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(chart.title)}" style="font-family:system-ui,sans-serif;background:white"><title>${escape(chart.title)} · ${escape(chart.metric)}</title>${body}</svg>`;
}

export function renderCharts(container: HTMLElement, charts: Chart[]) {
  container.replaceChildren();
  for (const chart of charts) {
    const card = document.createElement('section'); card.className = 'chart-card';
    const heading = document.createElement('div'); heading.className = 'report-heading';
    const title = document.createElement('h3'); title.textContent = chart.title;
    const download = document.createElement('button'); download.className = 'quiet'; download.textContent = '下载 SVG ↓';
    const svg = chartSvg(chart);
    download.onclick = () => {
      const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml;charset=utf-8'}));
      const link = document.createElement('a'); link.href = url; link.download = `${chart.title.replace(/[\\/:*?"<>|]/g, '_')}.svg`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    heading.append(title, download);
    const plot = document.createElement('div'); plot.className = 'chart-plot'; plot.innerHTML = svg;
    const note = document.createElement('p'); note.className = 'hint'; note.textContent = chart.note;
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看图表数据';
    const data = document.createElement('pre'); data.textContent = chart.points.map(p => `${p.label}：${p.value}`).join('\n');
    details.append(summary, data); card.append(heading, plot, note, details); container.append(card);
  }
}
