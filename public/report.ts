import type { Chart, TableData } from '../src/charts.js';
import { chartSvg } from './charts.js';

const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

// 行内标记：先转义再套用，外链只放行 http/https，模型文本不会被当作 HTML 执行。
function inline(source: string): string {
  return escape(source)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// 表格：系统生成的图表格与模型写的 Markdown 表格共用；单元格默认只转义。
export function tableHtml(table: TableData, format: (cell: unknown) => string = escape): string {
  const head = table.columns.map(column => `<th>${format(column)}</th>`).join('');
  const body = table.rows.map(row => `<tr>${row.map(cell => `<td>${format(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="report-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// 单张图表：标题、图形或表格、口径提示、可展开的精确数值、SVG 下载。
export function figureHtml(chart: Chart): string {
  const download = chart.type === 'table' ? '' : `<button class="quiet" data-svg="${escape(chart.id)}">下载 SVG ↓</button>`;
  const caption = `<figcaption><b>${escape(chart.title)}</b><span class="figure-metric">${escape(chart.metric)}</span>${download}</figcaption>`;
  const plot = chart.type === 'table' ? tableHtml(chart.table) : `<div class="chart-plot">${chartSvg(chart)}</div>`;
  const values = chart.type === 'table' ? ''
    : chart.type === 'scatter'
      ? chart.series.map(point => `${point.label}：${chart.axes.x}=${point.x}，${chart.axes.y}=${point.y}`).join('\n')
      : chart.points.map(point => `${point.label}：${point.value}`).join('\n');
  const details = values ? `<details><summary>查看图表数据</summary><pre>${escape(values)}</pre></details>` : '';
  return `<figure class="report-figure" id="${escape(chart.id)}">${caption}${plot}<p class="hint">${escape(chart.note)}</p>${details}</figure>`;
}

const isRow = (line: string) => line.startsWith('|') && line.endsWith('|') && line.length > 2;
const cells = (line: string) => line.slice(1, -1).split('|').map(cell => cell.trim());
const divider = (row: string[]) => row.length > 0 && row.every(cell => /^:?-{2,}:?$/.test(cell));

// 段落中的 [[fig-N]] 单独成块，因此图表总是插在它所在的那段正文之后。
function paragraphHtml(text: string, take: (id: string) => string): string {
  return text.split(/(\[\[[^\]]+\]\])/).map(part => {
    const marker = part.match(/^\[\[(fig-\d+)\]\]$/);
    if (marker) return take(marker[1]);
    // 无法对应的编号（模型写错或已删除）直接丢弃，避免正文里留下方括号噪声。
    if (/^\[\[[^\]]+\]\]$/.test(part)) return '';
    const trimmed = part.trim();
    return trimmed ? `<p>${inline(trimmed)}</p>` : '';
  }).join('');
}

// 把模型输出的 Markdown 文章渲染成 HTML，并把图表按引用位置插入正文；
// 没有被引用的图表附在文末，不丢失任何一张图。
export function articleHtml(markdown: string, charts: Chart[]): string {
  const figures = new Map(charts.map(chart => [chart.id, chart]));
  const used = new Set<string>();
  const take = (id: string) => {
    const chart = figures.get(id);
    if (!chart || used.has(id)) return '';
    used.add(id); return figureHtml(chart);
  };
  const blocks: string[] = [];
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push(paragraphHtml(paragraph.join(' '), take)); paragraph = []; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) { flush(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { flush(); const level = heading[1].length; blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); blocks.push('<hr>'); continue; }
    if (isRow(line)) {
      flush();
      const rows: string[][] = [];
      while (index < lines.length && isRow(lines[index].trim())) { rows.push(cells(lines[index].trim())); index++; }
      index--;
      const [head = [], ...body] = rows;
      blocks.push(tableHtml({ columns: head, rows: body.filter(row => !divider(row)) }, cell => inline(String(cell))));
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flush(); blocks.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    const item = line.match(/^([-*+]|\d+[.)])\s+(.+)$/);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]); const items: string[] = [];
      while (index < lines.length) {
        const next = lines[index].trim().match(/^([-*+]|\d+[.)])\s+(.+)$/);
        if (!next) break;
        items.push(next[2]); index++;
      }
      index--;
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.map(entry => `<li>${inline(entry)}</li>`).join('')}</${tag}>`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  const rest = charts.filter(chart => !used.has(chart.id));
  if (rest.length) {
    blocks.push('<h2>附：其余图表</h2>');
    for (const chart of rest) blocks.push(figureHtml(chart));
  }
  return blocks.join('\n');
}
