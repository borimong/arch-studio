// 프로젝트와 설정을 data/ 아래 JSON 파일로 보관한다. DB 없이 파일 하나가 프로젝트 하나다.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const PROJECTS = path.join(DATA, 'projects');
const TRASH = path.join(DATA, 'trash');
const SETTINGS = path.join(DATA, 'settings.json');

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

// 프로젝트 id는 파일 이름이 되므로 경로 탈출이 없는 형식만 받는다.
const safeId = (id) => {
  if (!/^[a-z]+_[a-f0-9]{6,20}$/.test(id)) throw Object.assign(new Error('잘못된 프로젝트 id'), { status: 400 });
  return id;
};

async function ensureDirs() {
  await fs.mkdir(PROJECTS, { recursive: true });
  await fs.mkdir(TRASH, { recursive: true });
}

export function emptyBoard(name = '현재 아키텍처') {
  return {
    id: newId('board'),
    name,
    nodes: [],
    edges: [],
    notes: { summary: '', story: '', tradeoffs: [] },
    review: null,
    needsLayout: false,
  };
}

export async function listProjects() {
  await ensureDirs();
  const files = (await fs.readdir(PROJECTS)).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(PROJECTS, f), 'utf8'));
      items.push({ id: p.id, name: p.name, sourcePath: p.sourcePath || '', updatedAt: p.updatedAt, boards: p.boards.length });
    } catch {
      // 깨진 파일은 목록에서만 빼고 지우지 않는다.
    }
  }
  return items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getProject(id) {
  try {
    return JSON.parse(await fs.readFile(path.join(PROJECTS, `${safeId(id)}.json`), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw Object.assign(new Error('프로젝트가 없습니다'), { status: 404 });
    throw err;
  }
}

// 나중에 추가한 블록 필드다. 추가 전에 열어 둔 창은 이 키를 모른 채 블록을 저장하므로,
// 키가 아예 없으면 지운 것이 아니라 모르는 것으로 보고 저장된 값을 남긴다. 새 화면은 빈 칸도 []로 보낸다.
const LATER_NODE_FIELDS = ['inputs', 'outputs'];

async function keepNewerFields(project) {
  const stored = await getProject(project.id).catch(() => null);
  if (!stored) return;
  const storedNodes = new Map();
  for (const board of stored.boards || []) {
    for (const node of board.nodes || []) storedNodes.set(`${board.id}:${node.id}`, node.data || {});
  }
  for (const board of project.boards || []) {
    for (const node of board.nodes || []) {
      const old = storedNodes.get(`${board.id}:${node.id}`);
      if (!old || !node.data) continue;
      for (const key of LATER_NODE_FIELDS) {
        if (!(key in node.data) && key in old) node.data[key] = old[key];
      }
    }
  }
}

// base는 저장하는 쪽이 마지막으로 받은 updatedAt이다. 그사이 다른 창이 저장했으면 덮어쓰지 않고 409를 낸다.
export async function saveProject(project, { base, force = false } = {}) {
  await ensureDirs();
  safeId(project.id);
  if (!force) {
    const current = await getProject(project.id).catch(() => null);
    if (current && current.updatedAt !== base) {
      throw Object.assign(new Error('다른 창에서 먼저 저장한 내용이 있습니다'), { status: 409, updatedAt: current.updatedAt });
    }
  }
  await keepNewerFields(project);
  project.updatedAt = new Date().toISOString();
  // 임시 파일에 쓰고 이름을 바꿔서, 저장 중에 꺼져도 원본이 반쯤 덮이지 않게 한다.
  const file = path.join(PROJECTS, `${project.id}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, file);
  return project;
}

export async function createProject({ name, sourcePath = '', boards }) {
  const now = new Date().toISOString();
  const project = {
    id: newId('proj'),
    name: name || '새 프로젝트',
    sourcePath,
    createdAt: now,
    updatedAt: now,
    boards: boards?.length ? boards : [emptyBoard()],
  };
  project.activeBoardId = project.boards[0].id;
  return saveProject(project, { force: true });
}

// 삭제는 data/trash로 옮기기만 한다. 실수로 지워도 파일을 되살릴 수 있다.
export async function trashProject(id) {
  await ensureDirs();
  const from = path.join(PROJECTS, `${safeId(id)}.json`);
  await fs.rename(from, path.join(TRASH, `${id}_${Date.now()}.json`));
}

export async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeSettings(patch) {
  await ensureDirs();
  const next = { ...(await readSettings()), ...patch };
  await fs.writeFile(SETTINGS, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export async function writeDebug(name, data) {
  const dir = path.join(DATA, 'debug');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), JSON.stringify(data, null, 2));
}
