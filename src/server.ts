import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable } from './context.js';
import { createModel } from './models.js';
import { analyze } from './task.js';
import type { Model } from './types.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets: Record<string, [string, string]> = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/charts.js': ['dist/public/charts.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['dist/public/app.js', 'text/javascript; charset=utf-8'],
};

// Node 原生 HTTP：直接接收文件字节，不引入 Web 框架或 multipart 中间件。
export function createApp({ model, memoryDir = join(root, 'memory') }: { model?: Model; memoryDir?: string } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (data: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
    };
    try {
      if (req.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
        const [file, type] = assets[url.pathname];
        const body = await readFile(join(root, file));
        res.writeHead(200, { 'Content-Type': type }); res.end(body); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        json({ configured: Boolean(model || (process.env.MODEL_API_KEY && process.env.MODEL_NAME)), model: model ? '测试模型' : process.env.MODEL_NAME ?? '' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/memory') {
        const files = await readdir(memoryDir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
        const memories = await Promise.all(files.filter(f => /^[a-f0-9]{16}\.md$/.test(f)).map(async file => ({ file, content: await readFile(join(memoryDir, file), 'utf8') })));
        json(memories); return;
      }
      if (req.method !== 'POST' || url.pathname !== '/api/analyze') { json({ error: '未找到接口' }, 404); return; }
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) { json({ error: '文件不能超过 5 MB' }, 413); return; }
        chunks.push(chunk);
      }
      const table = await parseTable(Buffer.concat(chunks), url.searchParams.get('filename') ?? '');
      const currentModel = model ?? createModel(controller.signal);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.flushHeaders();
      // 每个 hook 事件独立写入响应；前端用 ReadableStream 持续读取。
      await analyze(table, (url.searchParams.get('query') ?? '').slice(0, 2000), currentModel,
        event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); }, memoryDir);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) { if (!res.destroyed) res.end(`${JSON.stringify({ type: 'error', text: message })}\n`); }
      else json({ error: message }, 400);
    }
  });
}

// 被测试导入时不监听端口；npm start 时启动本机个人 demo。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '127.0.0.1', () => console.log(`表格 Agent → http://127.0.0.1:${port}`));
}
