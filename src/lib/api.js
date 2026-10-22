// 서버 API 호출(로컬 서버와 Cloudflare Worker가 같은 모양). 실패하면 서버가 준 한국어 오류 문구로 예외를 던진다.
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // 클라우드에서 세션이 끝나면 새로고침해서 로그인 화면으로 돌아간다.
  if (res.status === 401 && data.needLogin) window.location.reload();
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패(${res.status})`), { status: res.status });
  return data;
}

export const api = {
  me: () => request('GET', '/api/me'),
  login: (body) => request('POST', '/api/auth/login', body),
  signup: (body) => request('POST', '/api/auth/signup', body),
  logout: () => request('POST', '/api/auth/logout'),
  listProjects: () => request('GET', '/api/projects'),
  getProject: (id) => request('GET', `/api/projects/${id}`),
  createProject: (body) => request('POST', '/api/projects', body),
  saveProject: (p, base) => request('PUT', `/api/projects/${p.id}`, { ...p, _base: base }),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  listDirs: (path) => request('GET', `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  startImport: (body) => request('POST', '/api/import', body),
  getJob: (id) => request('GET', `/api/jobs/${id}`),
  review: (board) => request('POST', '/api/ai/review', { board }),
  tradeoff: (board, target) => request('POST', '/api/ai/tradeoff', { board, target }),
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (body) => request('PUT', '/api/settings', body),
};

export const uid = (prefix) => `${prefix}_${Math.random().toString(16).slice(2, 12)}`;
