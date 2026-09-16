import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

// 同一组字段共用一份经验；列顺序变化仍能召回，不同结构不会混用。
const memoryFile = (columns: string[]) => `${createHash('sha256').update(JSON.stringify([...columns].sort())).digest('hex').slice(0, 16)}.md`;
export async function loadMemory(columns: string[], dir = 'memory'): Promise<string> {
  try { return (await readFile(join(dir, memoryFile(columns)), 'utf8')).slice(0, 6000); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}
export async function saveMemory(columns: string[], content: string, dir = 'memory'): Promise<string> {
  if (!content.trim() || content.length > 3000) throw new Error('经验应为 1–3000 字的简短文本');
  await mkdir(dir, { recursive: true });
  const file = join(dir, memoryFile(columns));
  const temp = `${file}.${randomUUID()}.tmp`;
  // 临时文件 + 重命名，避免下次任务读到只写了一半的 Markdown。
  await writeFile(temp, `# 表格分析经验\n\n更新时间：${new Date().toISOString()}\n\n${content.trim()}\n`, 'utf8');
  await rename(temp, file);
  return file;
}
