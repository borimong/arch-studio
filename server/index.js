// Arch Studio 로컬 서버. 화면(dist)과 API를 함께 제공하고, 내 컴퓨터(127.0.0.1)에서만 열린다.
import http from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as store from './store.js';
import { scanProject, listDirs } from './scan.js';
import { importFromScan, reviewBoard, suggestTradeoff, aiStatus } from './ai.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8790);

// .env가 있으면 읽어 둔다. 이미 셸에 있는 값이 우선이다.
try {
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // .env 없이도 설정 화면에서 키를 넣을 수 있다.
}

// 가져오기는 1분 가까이 걸려서 작업으로 돌리고 화면이 단계를 조회한다.
const jobs = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20 * 1024 * 1024) throw Object.assign(new Error('요청이 너무 큽니다'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 형식이 아닙니다'), { status: 400 });
  }
}

function startImport({ sourcePath, mode, projectId }) {
  const job = { id: store.newId('job'), stage: 'scan', error: null, result: null, stats: null, startedAt: Date.now() };
  jobs.set(job.id, job);

  (async () => {
    const scan = await scanProject(sourcePath);
    job.stats = scan.stats;
    const generated = await importFromScan(scan, (stage) => (job.stage = stage));
    job.stage = 'save';

    const board = { ...store.emptyBoard(mode === 'board' ? `AI 분석 ${new Date().toLocaleDateString('ko-KR')}` : '현재 아키텍처'), ...generated, needsLayout: true };
    delete board.title;

    let project;
    if (mode === 'board' && projectId) {
      project = await store.getProject(projectId);
      project.boards.push(board);
      project.activeBoardId = board.id;
      project.sourcePath ||= sourcePath;
      await store.saveProject(project, { force: true });
    } else {
      project = await store.createProject({ name: generated.title || scan.name, sourcePath, boards: [board] });
    }
    job.result = { projectId: project.id, boardId: board.id };
    job.stage = 'done';
  })().catch((err) => {
    job.error = err.message;
    job.stage = 'error';
  });

  return job;
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const method = req.method;

  // 화면은 이 응답으로 로컬 모드(로그인 없음, 폴더 분석 가능)인지 안다.
  if (parts[0] === 'me' && method === 'GET') return send(res, 200, { mode: 'local', user: null });

  if (parts[0] === 'projects') {
    if (parts.length === 1 && method === 'GET') return send(res, 200, await store.listProjects());
    if (parts.length === 1 && method === 'POST') {
      const body = await readBody(req);
      return send(res, 201, await store.createProject({ name: body.name, boards: body.boards, sourcePath: body.sourcePath }));
    }
    const id = parts[1];
    if (method === 'GET') return send(res, 200, await store.getProject(id));
    if (method === 'PUT') {
      const body = await readBody(req);
      if (body.id !== id || !Array.isArray(body.boards)) return send(res, 400, { error: '프로젝트 형식이 맞지 않습니다' });
      const base = body._base;
      delete body._base;
      return send(res, 200, { updatedAt: (await store.saveProject(body, { base })).updatedAt });
    }
    if (method === 'DELETE') {
      await store.trashProject(id);
      return send(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'fs' && method === 'GET') {
    const target = path.resolve(url.searchParams.get('path') || os.homedir());
    const dirs = await listDirs(target).catch(() => null);
    if (!dirs) return send(res, 400, { error: '폴더를 열 수 없습니다' });
    return send(res, 200, { path: target, parent: path.dirname(target), home: os.homedir(), dirs });
  }

  if (parts[0] === 'import' && method === 'POST') {
    const body = await readBody(req);
    if (!body.path) return send(res, 400, { error: '폴더 경로가 필요합니다' });
    const job = startImport({ sourcePath: path.resolve(body.path), mode: body.mode, projectId: body.projectId });
    return send(res, 202, { jobId: job.id });
  }

  if (parts[0] === 'jobs' && method === 'GET') {
    const job = jobs.get(parts[1]);
    return job ? send(res, 200, job) : send(res, 404, { error: '작업이 없습니다' });
  }

  if (parts[0] === 'ai' && method === 'POST') {
    const body = await readBody(req);
    if (parts[1] === 'review') return send(res, 200, await reviewBoard(body.board));
    if (parts[1] === 'tradeoff') return send(res, 200, await suggestTradeoff(body.board, body.target));
  }

  if (parts[0] === 'settings') {
    if (method === 'GET') return send(res, 200, await aiStatus());
    if (method === 'PUT') {
      const body = await readBody(req);
      const patch = {};
      for (const k of ['apiKey', 'model', 'baseUrl']) if (typeof body[k] === 'string') patch[k] = body[k].trim();
      await store.writeSettings(patch);
      return send(res, 200, await aiStatus());
    }
  }

  return send(res, 404, { error: '없는 API입니다' });
}

async function serveStatic(res, url) {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) file = path.join(DIST, 'index.html');
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('화면 파일이 없습니다. npm run build를 먼저 실행하세요.');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(res, url);
  } catch (err) {
    send(res, err.status || 500, { error: err.message || '서버 오류', ...(err.updatedAt ? { updatedAt: err.updatedAt } : {}) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Arch Studio: http://localhost:${PORT}`);
});
