// 블록 종류별 이름과 색. 서버의 KINDS 목록과 같은 키를 쓴다.
export const KINDS = {
  client: { label: '사용자', color: '#64748b', short: 'U' },
  frontend: { label: '프론트엔드', color: '#3b82f6', short: 'FE' },
  gateway: { label: '게이트웨이', color: '#0ea5e9', short: 'GW' },
  backend: { label: '백엔드', color: '#6366f1', short: 'BE' },
  worker: { label: '워커', color: '#8b5cf6', short: 'WK' },
  agent: { label: 'AI Agent', color: '#c026d3', short: 'AG' },
  mcp: { label: 'MCP 서버', color: '#db2777', short: 'MCP' },
  llm: { label: 'LLM', color: '#e11d48', short: 'LLM' },
  database: { label: '데이터베이스', color: '#d97706', short: 'DB' },
  cache: { label: '캐시', color: '#ea580c', short: 'C' },
  queue: { label: '메시지 큐', color: '#059669', short: 'Q' },
  storage: { label: '스토리지', color: '#ca8a04', short: 'S3' },
  search: { label: '검색', color: '#0d9488', short: 'SE' },
  external: { label: '외부 서비스', color: '#78716c', short: 'EXT' },
  infra: { label: '인프라', color: '#0891b2', short: 'INF' },
  observability: { label: '관측', color: '#0284c7', short: 'OBS' },
  auth: { label: '인증', color: '#dc2626', short: 'ID' },
  other: { label: '기타', color: '#94a3b8', short: '?' },
};

export const kindOf = (k) => KINDS[k] || KINDS.other;

export const PALETTE = ['client', 'frontend', 'gateway', 'backend', 'worker', 'agent', 'mcp', 'llm', 'database', 'cache', 'queue', 'storage', 'search', 'external', 'infra', 'observability', 'auth'];

export const ZONE_COLORS = ['#6366f1', '#0ea5e9', '#c026d3', '#d97706', '#059669', '#78716c', '#e11d48'];

export const emptyTradeoff = () => ({ decision: '', alternatives: [], pros: [], cons: [], why: '' });

export const hasTradeoff = (t) => Boolean(t && (t.decision || t.why || t.pros?.length || t.cons?.length));
