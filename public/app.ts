import { renderCharts } from './charts.js';
import type { Chart } from '../src/charts.js';
import type { Event } from '../src/types.js';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = el<HTMLInputElement>('file');
const runButton = el<HTMLButtonElement>('run');
let file: File | undefined;
let controller: AbortController | undefined;
let report = ''; let count = 0;

function selectTab(name: 'process' | 'result') {
  for (const tab of ['process', 'result']) {
    el(tab).hidden = tab !== name;
    el(`${tab}-tab`).classList.toggle('active', tab === name);
    el(`${tab}-tab`).setAttribute('aria-selected', String(tab === name));
  }
}
for (const name of ['process', 'result'] as const) {
  el(`${name}-tab`).onclick = () => selectTab(name);
  el(`${name}-tab`).onkeydown = event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const next = name === 'process' ? 'result' : 'process'; selectTab(next); el(`${next}-tab`).focus();
    }
  };
}
function chooseFile(next?: File) {
  if (controller || !next) return;
  const valid = /\.(csv|xlsx)$/i.test(next.name) && next.size <= 5 * 1024 * 1024;
  file = valid ? next : undefined;
  runButton.disabled = !file;
  el('file-name').textContent = file?.name ?? '选择或拖入Excel / CSV 表格';
  el('file-hint').textContent = file ? `${(file.size / 1024).toFixed(1)} KB · 点击更换文件` : 'CSV / XLSX · 最大 5 MB';
  el('notice').textContent = valid ? '' : '请选择不超过 5 MB 的 CSV 或 XLSX 文件。';
  // 更换文件即清空旧结果，避免误把上一次统计当成当前数据。
  el('events').replaceChildren(); el('metrics').replaceChildren(); el('charts').replaceChildren(); count = 0; report = '';
  el('empty').hidden = false; el('report').hidden = true; el('result-empty').hidden = false;
  el('event-count').textContent = '0'; el('scope-text').textContent = valid ? '新文件已选择，等待分析' : '尚未上传数据';
  el('run-state').textContent = valid ? '准备就绪' : '等待上传'; selectTab('process');
}
fileInput.onchange = () => chooseFile(fileInput.files?.[0]);
const dropzone = el('dropzone');
dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add('drag'); };
dropzone.ondragleave = () => dropzone.classList.remove('drag');
dropzone.ondrop = event => { event.preventDefault(); dropzone.classList.remove('drag'); chooseFile(event.dataTransfer?.files[0]); };

// 所有模型文本和表格数据通过 textContent 呈现，不作为 HTML 执行。
function addEvent(event: Event) {
  const labels: Record<string, string> = { context: '数据', memory: '记忆', thinking: '分析摘要', tool_start: '工具调用', tool_end: '工具结果', error: '错误' };
  const item = document.createElement('article'); item.className = `event ${event.type}`;
  const heading = document.createElement('div'); heading.className = 'event-heading';
  const tag = document.createElement('b'); tag.textContent = labels[event.type] ?? event.type;
  const time = document.createElement('span'); time.textContent = new Date().toLocaleTimeString('zh-CN');
  heading.append(tag, time);
  const text = document.createElement('p'); text.textContent = event.text; item.append(heading, text);
  if (event.data) {
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看详情';
    const pre = document.createElement('pre'); pre.textContent = typeof event.data === 'string' ? event.data : JSON.stringify(event.data, null, 2);
    details.append(summary, pre); item.append(details);
  }
  el('events').append(item); el('event-count').textContent = String(++count);
  el('events').scrollTop = el('events').scrollHeight;
}
function handleEvent(event: Event) {
  if (event.type === 'done') {
    renderCharts(el('charts'), (event.data as { charts?: Chart[] } | undefined)?.charts ?? []);
    report = event.text; el('report-text').textContent = report;
    el('result-empty').hidden = true; el('report').hidden = false;
    el('run-state').textContent = '分析完成'; selectTab('result'); return;
  }
  addEvent(event);
  if (event.type === 'error') throw new Error(event.text);
  if (event.type === 'context') el('scope-text').textContent = event.text;
  if (event.type === 'tool_end') {
    const data = event.data as { name: string; result: Record<string, unknown> };
    if (data.name === 'overview' && !data.result.error) {
      el('metrics').replaceChildren(); el('charts').replaceChildren();
      for (const [key, label] of [['records', '记录数'], ['fieldCount', '字段数'], ['duplicateRows', '重复行数']] as const) {
        if (typeof data.result[key] !== 'number') continue;
        const card = document.createElement('div'); card.className = 'metric';
        const title = document.createElement('label'); title.textContent = label;
        const value = document.createElement('strong'); value.textContent = (data.result[key] as number).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        card.append(title, value); el('metrics').append(card);
      }
    }
  }
}

runButton.onclick = async () => {
  if (controller) { controller.abort(); return; }
  if (!file) return;
  controller = new AbortController(); report = ''; count = 0;
  el('events').replaceChildren(); el('metrics').replaceChildren(); el('charts').replaceChildren(); el('event-count').textContent = '0';
  el('empty').hidden = true; el('report').hidden = true; el('result-empty').hidden = false;
  el('notice').textContent = ''; el('run-state').textContent = '正在分析…';
  selectTab('process'); runButton.textContent = '停止分析'; fileInput.disabled = true;
  try {
    const query = new URLSearchParams({ filename: file.name, query: el<HTMLTextAreaElement>('query').value });
    const response = await fetch(`/api/analyze?${query}`, { method: 'POST', body: file, signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error || '上传失败');
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let pending = '';
    // 网络分片不等于事件边界：累积缓冲后按换行拆分，避免中文与 JSON 被截断。
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
      if (done) { if (pending.trim()) handleEvent(JSON.parse(pending)); break; }
    }
    if (!report) throw new Error('连接结束但尚未收到完整报告，请重试');
  } catch (error) {
    controller.abort();
    const stopped = error instanceof Error && error.name === 'AbortError';
    el('notice').textContent = stopped ? '已停止分析，可重新执行。' : (error instanceof Error ? error.message : String(error));
    el('run-state').textContent = stopped ? '已停止' : '分析未完成';
    if (!stopped) addEvent({ type: 'error', text: el('notice').textContent! });
  } finally {
    controller = undefined; runButton.textContent = '重新分析 →'; fileInput.disabled = false;
  }
};
el('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = '表格分析报告.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
el('memory-button').onclick = async () => {
  el<HTMLDialogElement>('memory-dialog').showModal(); el('memory-list').textContent = '正在读取…';
  try {
    const response = await fetch('/api/memory'); if (!response.ok) throw new Error('无法读取记忆');
    const memories: { file: string; content: string }[] = await response.json();
    el('memory-list').replaceChildren();
    if (!memories.length) el('memory-list').textContent = '暂无记忆。完成一次分析后，智能体会保存可复用经验。';
    for (const memory of memories) {
      const section = document.createElement('section'); section.className = 'memory-item';
      const title = document.createElement('h3'); title.textContent = `memory/${memory.file}`;
      const pre = document.createElement('pre'); pre.textContent = memory.content; section.append(title, pre); el('memory-list').append(section);
    }
  } catch (error) { el('memory-list').textContent = String(error); }
};
el('close-memory').onclick = () => el<HTMLDialogElement>('memory-dialog').close();
fetch('/api/status').then(r => r.json()).then(status => {
  el('model-status').textContent = status.configured ? `● ${status.model}` : '模型未配置';
  el('model-status').classList.toggle('ready', status.configured);
  if (!status.configured) el('notice').textContent = '请在 .env 配置 MODEL_API_KEY 和 MODEL_NAME，再重启服务。';
}).catch(() => { el('model-status').textContent = '服务未连接'; });
