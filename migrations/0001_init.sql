-- Arch Studio 클라우드 저장소. 프로젝트는 (user_id, id)로 나뉘어서 같은 원본에서 시작해도 사람마다 따로 저장된다.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- 쿠키에는 원래 토큰을, DB에는 SHA-256 해시만 둔다.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE projects (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL DEFAULT '',
  board_count INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX projects_user_updated ON projects(user_id, updated_at);
