// Arch Studio Cloudflare Worker. 화면(dist)은 정적 자산으로, /api/* 는 여기서 처리한다.
// 로컬 서버(server/index.js)와 같은 API 모양을 유지하되, 모든 데이터가 로그인한 사람 기준으로 나뉜다.
// 가입하면 배포 시점의 로컬 아키텍처(seed.json)가 그 사람 계정으로 복사되고, 이후 수정은 그 사람 사본에만 반영된다.
import seed from './seed.json';
import { aiStatusOf, httpError, newId, reviewBoard, suggestTradeoff } from '../server/ai-core.js';

const SESSION_COOKIE = '__Host-arch_sid';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const MAX_PROJECT_BYTES = 1_800_000; // D1 한 행 한도(2MB) 아래로 둔다.
const DEFAULT_AI = { model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' };

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const sha256 = async (text) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return toHex(bits);
}

function sameHex(a, b) {
  const x = fromHex(a);
  const y = fromHex(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}

const safeId = (id) => {
  if (!/^[a-z]+_[a-f0-9]{6,20}$/.test(id || '')) throw httpError(400, '잘못된 프로젝트 id');
  return id;
};

async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_PROJECT_BYTES * 1.2) throw httpError(413, '요청이 너무 큽니다');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, 'JSON 형식이 아닙니다');
  }
}

// ---------- 세션 ----------

function readCookie(req, name) {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

const sessionCookie = (token, maxAge) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function startSession(env, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expires).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function currentUser(req, env) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare(
    'SELECT u.id, u.username, u.settings FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  )
    .bind(await sha256(token), new Date().toISOString())
    .first();
}

// ---------- 가입과 로그인 ----------

function checkCredentials(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw httpError(400, '아이디는 영문, 숫자, _ . - 로 3~32자입니다');
  if (password.length < 8 || password.length > 200) throw httpError(400, '비밀번호는 8자 이상입니다');
  return { username, password };
}

// 배포할 때 넣어 둔 원본 아키텍처를 새 계정의 사본으로 만든다. id는 계정마다 따로 저장되므로 그대로 둔다.
function seedStatements(env, userId) {
  const now = new Date().toISOString();
  return seed.map((p) => {
    const copy = { ...structuredClone(p), updatedAt: now };
    return env.DB.prepare('INSERT INTO projects (user_id, id, name, source_path, board_count, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      userId,
      copy.id,
      copy.name,
      copy.sourcePath || '',
      copy.boards.length,
      JSON.stringify(copy),
      now,
    );
  });
}

async function signup(req, env) {
  const { username, password } = checkCredentials(await readBody(req));
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) throw httpError(409, '이미 있는 아이디입니다');
  const id = newId('user');
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, username, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, username, salt, hash, new Date().toISOString()),
      ...seedStatements(env, id),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) throw httpError(409, '이미 있는 아이디입니다');
    throw err;
  }
  return json(201, { mode: 'cloud', user: { username } }, { 'Set-Cookie': await startSession(env, id) });
}

async function login(req, env) {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = await env.DB.prepare('SELECT id, username, pw_salt, pw_hash FROM users WHERE username = ?').bind(username).first();
  // 없는 아이디도 같은 시간만큼 해시를 돌려서 아이디 존재 여부가 응답 시간으로 드러나지 않게 한다.
  const hash = await hashPassword(password, user?.pw_salt || '00'.repeat(16));
  if (!user || !sameHex(hash, user.pw_hash)) throw httpError(401, '아이디 또는 비밀번호가 맞지 않습니다');
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(user.id, new Date().toISOString()).run();
  return json(200, { mode: 'cloud', user: { username: user.username } }, { 'Set-Cookie': await startSession(env, user.id) });
}

async function logout(req, env) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

// ---------- 프로젝트 ----------

async function listProjects(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, source_path AS sourcePath, updated_at AS updatedAt, board_count AS boards FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
  )
    .bind(user.id)
    .all();
  return results;
}

async function getProject(env, user, id) {
  const row = await env.DB.prepare('SELECT data FROM projects WHERE user_id = ? AND id = ? AND deleted_at IS NULL').bind(user.id, safeId(id)).first();
  if (!row) throw httpError(404, '프로젝트가 없습니다');
  return JSON.parse(row.data);
}

const emptyBoard = () => ({ id: newId('board'), name: '현재 아키텍처', nodes: [], edges: [], notes: { summary: '', story: '', tradeoffs: [] }, review: null, needsLayout: false });

function serialize(project) {
  const data = JSON.stringify(project);
  if (data.length > MAX_PROJECT_BYTES) throw httpError(413, '프로젝트가 너무 커서 저장할 수 없습니다. 보드를 나눠 주세요.');
  return data;
}

async function createProject(env, user, body) {
  const now = new Date().toISOString();
  const boards = Array.isArray(body.boards) && body.boards.length ? body.boards : [emptyBoard()];
  const project = { id: newId('proj'), name: String(body.name || '새 프로젝트').slice(0, 200), sourcePath: String(body.sourcePath || ''), createdAt: now, updatedAt: now, boards };
  project.activeBoardId = boards[0].id;
  await env.DB.prepare('INSERT INTO projects (user_id, id, name, source_path, board_count, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(user.id, project.id, project.name, project.sourcePath, boards.length, serialize(project), now)
    .run();
  return project;
}

// base는 저장하는 쪽이 마지막으로 받은 updatedAt이다. 같은 계정의 다른 창이 그사이 저장했으면 덮어쓰지 않고 409를 낸다.
async function saveProject(env, user, id, body) {
  if (body.id !== id || !Array.isArray(body.boards) || !body.boards.length) throw httpError(400, '프로젝트 형식이 맞지 않습니다');
  const base = body._base;
  delete body._base;
  const project = { ...body, name: String(body.name || '새 프로젝트').slice(0, 200), updatedAt: new Date().toISOString() };
  const result = await env.DB.prepare(
    'UPDATE projects SET name = ?, source_path = ?, board_count = ?, data = ?, updated_at = ? WHERE user_id = ? AND id = ? AND updated_at = ? AND deleted_at IS NULL',
  )
    .bind(project.name, String(project.sourcePath || ''), project.boards.length, serialize(project), project.updatedAt, user.id, safeId(id), String(base || ''))
    .run();
  if (result.meta.changes === 1) return { updatedAt: project.updatedAt };

  const current = await env.DB.prepare('SELECT updated_at FROM projects WHERE user_id = ? AND id = ? AND deleted_at IS NULL').bind(user.id, id).first();
  if (!current) throw httpError(404, '프로젝트가 없습니다');
  throw Object.assign(httpError(409, '다른 창에서 먼저 저장한 내용이 있습니다'), { updatedAt: current.updated_at });
}

// 삭제는 표시만 한다. 실수로 지워도 DB에서 되살릴 수 있다.
async function trashProject(env, user, id) {
  await env.DB.prepare('UPDATE projects SET deleted_at = ? WHERE user_id = ? AND id = ?').bind(new Date().toISOString(), user.id, safeId(id)).run();
}

// ---------- AI 설정 (계정마다 각자의 키) ----------

function aiConfig(user) {
  const s = JSON.parse(user.settings || '{}');
  return { apiKey: s.apiKey || '', model: s.model || DEFAULT_AI.model, baseUrl: (s.baseUrl || DEFAULT_AI.baseUrl).replace(/\/$/, '') };
}

async function saveSettings(env, user, body) {
  const next = JSON.parse(user.settings || '{}');
  for (const k of ['apiKey', 'model', 'baseUrl']) if (typeof body[k] === 'string') next[k] = body[k].trim();
  if (next.baseUrl && !/^https:\/\//.test(next.baseUrl)) throw httpError(400, 'API 주소는 https:// 로 시작해야 합니다');
  await env.DB.prepare('UPDATE users SET settings = ? WHERE id = ?').bind(JSON.stringify(next), user.id).run();
  return aiStatusOf(aiConfig({ settings: JSON.stringify(next) }));
}

// ---------- 라우터 ----------

async function api(req, env, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const method = req.method;

  if (parts[0] === 'auth' && method === 'POST') {
    if (parts[1] === 'signup') return signup(req, env);
    if (parts[1] === 'login') return login(req, env);
    if (parts[1] === 'logout') return logout(req, env);
  }

  const user = await currentUser(req, env);
  if (parts[0] === 'me' && method === 'GET') return json(200, { mode: 'cloud', user: user ? { username: user.username } : null });
  if (!user) return json(401, { error: '로그인이 필요합니다', needLogin: true });

  if (parts[0] === 'projects') {
    if (parts.length === 1 && method === 'GET') return json(200, await listProjects(env, user));
    if (parts.length === 1 && method === 'POST') return json(201, await createProject(env, user, await readBody(req)));
    const id = parts[1];
    if (method === 'GET') return json(200, await getProject(env, user, id));
    if (method === 'PUT') return json(200, await saveProject(env, user, id, await readBody(req)));
    if (method === 'DELETE') {
      await trashProject(env, user, id);
      return json(200, { ok: true });
    }
  }

  if (parts[0] === 'ai' && method === 'POST') {
    const body = await readBody(req);
    if (parts[1] === 'review') return json(200, await reviewBoard(aiConfig(user), body.board));
    if (parts[1] === 'tradeoff') return json(200, await suggestTradeoff(aiConfig(user), body.board, body.target));
  }

  if (parts[0] === 'settings') {
    if (method === 'GET') return json(200, aiStatusOf(aiConfig(user)));
    if (method === 'PUT') return json(200, await saveSettings(env, user, await readBody(req)));
  }

  if (parts[0] === 'fs' || parts[0] === 'import' || parts[0] === 'jobs') {
    return json(400, { error: '코드 폴더 분석은 로컬 버전에서만 됩니다' });
  }

  return json(404, { error: '없는 API입니다' });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      return json(status, { error: status === 500 ? '서버 오류' : err.message, ...(err.updatedAt ? { updatedAt: err.updatedAt } : {}) });
    }
  },
};
