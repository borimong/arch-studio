// 배포 전에 data/projects/*.json 을 worker/seed.json 으로 묶는다.
// 클라우드에서 새 계정을 만들면 이 묶음이 그 계정의 사본으로 들어간다.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'projects');
const OUT = path.join(ROOT, 'worker', 'seed.json');

const files = (await fs.readdir(DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
const projects = [];
for (const f of files) {
  const p = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8'));
  // 내 컴퓨터 경로 전체는 올리지 않고 폴더 이름만 남긴다.
  p.sourcePath = p.sourcePath ? path.basename(p.sourcePath) : '';
  projects.push(p);
}
projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
await fs.writeFile(OUT, JSON.stringify(projects));
console.log(`seed: 프로젝트 ${projects.length}개 (${projects.map((p) => p.name).join(', ')})`);
