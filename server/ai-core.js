// AI 호출의 공통 부분. 로컬 서버(server/ai.js)와 Cloudflare Worker(worker/index.js)가 같이 쓴다.
// 파일이나 설정을 직접 읽지 않고, 모델 설정 c({ apiKey, model, baseUrl })를 호출하는 쪽이 넘긴다.
// 응답은 모두 JSON Schema(strict)로 받아서, 화면이 바로 블록과 화살표로 그릴 수 있게 한다.

export const newId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export const aiStatusOf = (c) => ({ hasKey: Boolean(c.apiKey), model: c.model, baseUrl: c.baseUrl, keyHint: c.apiKey ? `...${c.apiKey.slice(-4)}` : '' });

export const KINDS = [
  'client', 'frontend', 'gateway', 'backend', 'worker', 'agent', 'mcp', 'llm', 'database', 'cache',
  'queue', 'storage', 'search', 'external', 'infra', 'observability', 'auth', 'other',
];

const str = { type: 'string' };
const strList = { type: 'array', items: str };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const TRADEOFF = obj({ decision: str, alternatives: strList, pros: strList, cons: strList, why: str });

export const STRUCTURE_SCHEMA = obj({
  title: str,
  summary: str,
  groups: { type: 'array', items: obj({ id: str, label: str }) },
  nodes: {
    type: 'array',
    items: obj({
      id: str,
      label: str,
      kind: { type: 'string', enum: KINDS },
      tech: str,
      group: str,
      description: str,
      inputs: strList,
      outputs: strList,
      responsibilities: strList,
      evidence: strList,
    }),
  },
  edges: {
    type: 'array',
    items: obj({ source: str, target: str, label: str, protocol: str, mode: { type: 'string', enum: ['sync', 'async'] } }),
  },
});

export const TRADEOFFS_SCHEMA = obj({
  nodes: { type: 'array', items: obj({ id: str, tradeoff: TRADEOFF }) },
  edges: { type: 'array', items: obj({ index: { type: 'integer' }, tradeoff: TRADEOFF }) },
  board: obj({
    summary: str,
    story: str,
    tradeoffs: { type: 'array', items: obj({ topic: str, chosen: str, alternatives: strList, pros: strList, cons: strList, why: str }) },
  }),
});

const REVIEW_SCHEMA = obj({
  strengths: strList,
  risks: { type: 'array', items: obj({ title: str, detail: str, suggestion: str }) },
  questions: { type: 'array', items: obj({ question: str, answer: str }) },
});

const COMMON_RULES = `
- 모든 설명은 한국어로 쓰고, 기술 이름(Spring Boot, RabbitMQ 등)은 원문 그대로 쓴다.
- 가운뎃점 문자(U+00B7)와 긴 대시는 쓰지 않는다. 나열은 쉼표로 한다.
- 코드 단서에 없는 컴포넌트나 기술을 지어내지 않는다. 모르면 비워 두거나 "코드에서 확인 안 됨"이라고 쓴다.`;

export const STRUCTURE_PROMPT = `너는 시니어 소프트웨어 아키텍트다. 주어진 코드 단서(폴더 구조, 설정 파일, 주요 소스)만 보고 이 시스템의 아키텍처를 블록 다이어그램으로 정리한다.
규칙:
- 블록은 배포 단위(컨테이너, 서비스, 앱)나 그에 준하는 핵심 모듈이다. 보통 8~18개. 함수나 클래스 단위로 쪼개지 않는다.
- 사용자(브라우저 또는 앱 사용자) 블록을 하나 둔다. kind는 client.
- OpenAI, LangSmith, S3 같은 외부 서비스도 블록으로 둔다. LLM API는 kind llm, 나머지 외부는 external.
- 하나의 서비스 안에 아키텍처상 중요한 하위 모듈(예: Agent 그래프, 업무 규칙 엔진)이 있으면 별도 블록으로 둘 수 있다.
- groups는 계층이나 배포 경계 2~6개(예: 프론트엔드, 백엔드, AI, 데이터, 외부 서비스). 블록의 group에는 groups의 id를 넣고, 어디에도 안 맞으면 빈 문자열.
- id는 영문 소문자와 밑줄만 쓴다(예: backend_api).
- edges는 요청이나 메시지가 흐르는 방향으로 그린다(호출하는 쪽에서 받는 쪽으로). 큐는 생산자에서 큐로, 큐에서 소비자로 그린다.
- 연결 근거를 빠짐없이 찾는다. compose의 depends_on, 환경 변수에 들어 있는 다른 서비스 주소(예: BACKEND_URL, *_HOST, DATABASE_URL, SPRING_DATASOURCE_URL, AMQP URL), 소스의 HTTP 클라이언트와 리스너 선언이 근거다.
- 데이터베이스와 큐에는 그것을 읽거나 쓰는 서비스를 모두 연결한다. 같은 큐 서버라도 발행하는 쪽과 소비하는 쪽을 각각 잇는다.
- SSE나 WebSocket처럼 서버가 밀어 주는 스트림은 구독하는 쪽(클라이언트)에서 서버로 그리고, label을 "진행 이벤트 구독"처럼 쓴다.
- 같은 코드를 다른 실행 모드로 띄운 서비스(예: 같은 이미지를 worker 프로필로 띄운 컨테이너)도 별도 블록으로 둔다.
- 배치 작업이나 일회성 컨테이너(예: 인덱서, 마이그레이션)도 아키텍처상 의미가 있으면 블록으로 둔다.
- edge label은 짧게(예: "REST 호출", "SSE 진행 이벤트", "작업 발행"). protocol은 HTTP, gRPC, AMQP, SQL, WebSocket, SSE, MCP 같은 이름. 응답을 기다리면 sync, 큐나 이벤트면 async.
- kind 고르기: LLM으로 판단하고 도구를 호출하는 서비스(LangGraph, LangChain, Agent SDK 등)는 agent, MCP 서버는 mcp, LLM API는 llm, 브라우저 화면은 frontend, 큐를 소비해 배치나 비동기 작업을 하는 프로세스는 worker, 일반 API 서버만 backend로 한다.
- tech는 블록의 핵심 기술 1~3개를 쉼표로(예: "Spring Boot 3, Java 21").
- description은 한 문장, responsibilities는 2~4개, evidence는 근거가 된 파일 경로 1~3개.
- inputs와 outputs는 각 1~4개. inputs는 이 블록이 받는 요청, 메시지, 데이터이고 outputs는 내보내는 응답, 메시지, 저장 결과다. "무엇을(어디서/어디로)" 형태로 구체적으로 쓴다(예: "재계획 작업 메시지(RabbitMQ replan 큐)", "변경안과 승인 요청(backend /internal API)"). 코드에서 확인되지 않으면 추측하지 않고 적게 쓴다.
- summary는 시스템 전체를 2~3문장으로.${COMMON_RULES}`;

export const AUDIT_PROMPT = `너는 아키텍처 검토자다. 다른 아키텍트가 코드 단서로 그린 아키텍처 초안을 아래 체크리스트로 점검하고, 고친 최종본을 같은 형식으로 낸다.
체크리스트:
1. compose나 배포 설정에 있는 서비스(컨테이너)가 모두 블록으로 있는가. 빠졌으면 추가한다.
2. 환경 변수나 설정에 보이는 외부 API(LLM, 추적, 결제, 메일, 스토리지 등)가 블록으로 있는가.
3. 데이터베이스, 캐시, 큐마다 그것을 읽거나 쓰는 서비스가 모두 연결되어 있는가. 특히 API 서버와 DB 연결, 큐의 발행자와 소비자 연결을 확인한다.
4. 화살표 방향이 호출하는 쪽에서 받는 쪽인가. 큐는 생산자에서 큐, 큐에서 소비자. 거꾸로 된 것은 뒤집는다.
5. 근거 없는 연결은 지운다. 같은 두 블록 사이 같은 의미의 연결이 두 개면 하나로 합친다.
6. kind가 규칙에 맞는가(Agent는 agent, MCP 서버는 mcp, LLM API는 llm).
7. 그룹이 2~6개이고 블록이 하나뿐인 그룹이 너무 많지 않은가.
초안의 id는 가능한 한 그대로 둔다.
${STRUCTURE_PROMPT}`;

export const TRADEOFF_PROMPT = `너는 시니어 아키텍트이자 기술 면접관이다. 이미 정리된 아키텍처의 블록과 화살표마다 기술 선택의 트레이드오프를 쓴다. 지원자가 면접에서 "왜 이걸 골랐나요, 다른 선택지는요?"에 답할 수 있어야 한다.
규칙:
- nodes에는 모든 블록에 대해 하나씩, edges에는 연결 방식이 설계 결정인 화살표(동기 vs 비동기, 프로토콜 선택 등)에 대해 index로 쓴다.
- decision: 어떤 문제를 어떻게 풀기로 했는지 한 줄. "X에 Y 사용" 같은 틀은 금지한다.
  나쁜 예: "백엔드 API에 Spring Boot 사용". 좋은 예: "재계획 요청은 202로 바로 응답하고 실제 계산은 RabbitMQ로 Agent에 넘김".
- 외부 서비스 블록은 "왜 썼나"보다 "어떻게 의존하고, 장애나 비용은 어떻게 다루나"를 결정으로 쓴다.
- alternatives: 현실적인 대안 2~3개.
- pros, cons: 각 2~3개. "확장성이 좋다", "복잡성 증가" 같은 일반론은 금지한다. 이 시스템의 다른 블록 이름이나 실제 상황을 넣어서 무엇이 좋아지고 무엇을 감수하는지 쓴다.
  좋은 예: "Agent 컨테이너가 죽어도 작업이 큐에 남아 다시 처리된다", "진행 상황을 화면에 보여 주려면 SSE 같은 별도 통로가 필요하다".
- why: 이 프로젝트 맥락에서 이 선택이 맞는 이유 1~2문장. 코드에 근거가 보이면 근거를 쓴다.
- board.summary: 시스템 요약 2~3문장.
- board.story: "왜 이 구조일 수밖에 없는가"를 문제, 제약, 선택, 결과 순서의 4~6문장 이야기로. 면접에서 1분 안에 말할 수 있게.
  README와 코드에 보이는 도메인 문제, 구체 제약(응답 시간, 승인 절차, 외부 연동, 데이터 규칙 등)을 넣는다. "신뢰성과 확장성을 보장한다" 같은 문장은 금지한다.
- board.tradeoffs: 시스템 전체 수준 결정 3~6개(예: 서비스 분리 vs 모놀리스, 동기 호출 vs 메시지 큐, 업무 규칙 위치).${COMMON_RULES}`;

const REVIEW_PROMPT = `너는 까다로운 시니어 아키텍트 면접관이다. 지원자가 그린 아키텍처 다이어그램을 보고 리뷰한다.
- strengths: 잘한 설계 3~5개, 구체적으로.
- risks: 약점이나 빠진 부분 3~6개. title은 짧게, detail은 왜 문제인지, suggestion은 어떻게 고치거나 면접에서 어떻게 방어할지.
- questions: 면접관이 실제로 물을 법한 꼬리 질문 5~8개와, 이 다이어그램과 트레이드오프 메모를 근거로 한 모범 답변. 답변은 2~4문장, 트레이드오프를 인정하면서 선택 이유를 말하는 형태로.${COMMON_RULES}`;

const SINGLE_PROMPT = `너는 시니어 아키텍트다. 아키텍처 다이어그램의 한 요소(블록 또는 연결)에 대한 기술 선택 트레이드오프를 쓴다.
- decision 한 줄, alternatives 2~3개, pros와 cons 각 2~3개(이 시스템에서 구체적으로), why 1~2문장.
- 사용자가 이미 적어 둔 내용이 있으면 그 의도를 유지하면서 보강한다.${COMMON_RULES}`;

// 프롬프트로 막아도 모델이 가끔 가운뎃점이나 긴 대시를 쓰므로 응답 전체에서 쉼표로 바꾼다.
const clean = (v) =>
  typeof v === 'string'
    ? v.replace(/\s*[\u00B7\u2014\u2013]\s*/g, ', ')
    : Array.isArray(v)
      ? v.map(clean)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]))
        : v;

export const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function callJson(c, { system, user, schema, name, temperature = 0.2 }) {
  const local = /localhost|127\.0\.0\.1/.test(c.baseUrl);
  if (!c.apiKey && !local) throw httpError(400, 'OpenAI API 키가 없습니다. 오른쪽 위 설정에서 입력하세요.');

  const body = {
    model: c.model,
    temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
  };

  // 429와 5xx는 잠깐 기다렸다 다시 시도한다. 인증 오류나 요청 오류는 바로 알린다.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify(body),
    }).catch((err) => {
      throw httpError(502, `모델 서버에 연결하지 못했습니다: ${err.message}`);
    });
    if (res.ok) {
      const data = await res.json();
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) throw httpError(502, `모델이 응답을 거부했습니다: ${choice.message.refusal}`);
      try {
        return { result: clean(JSON.parse(choice.message.content)), usage: data.usage };
      } catch {
        throw httpError(502, '모델 응답을 JSON으로 읽지 못했습니다');
      }
    }
    const detail = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 401) throw httpError(401, 'API 키가 올바르지 않습니다');
    if (res.status === 403) throw httpError(403, `이 키로 ${c.model} 모델을 쓸 수 없습니다`);
    if (res.status === 429) throw httpError(429, '요청 한도나 잔액이 부족합니다');
    throw httpError(502, `모델 호출 실패(${res.status}): ${detail.slice(0, 300)}`);
  }
}

const slug = (s, fallback) => (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
const emptyTradeoff = () => ({ decision: '', alternatives: [], pros: [], cons: [], why: '' });

// 모델이 만든 구조를 검사하고 React Flow 노드와 엣지 형태로 바꾼다.
export function toBoard(structure, tradeoffs) {
  const ids = new Map();
  const used = new Set();
  for (const [i, n] of structure.nodes.entries()) {
    let id = slug(n.id, `node_${i}`);
    while (used.has(id)) id = `${id}_${i}`;
    used.add(id);
    ids.set(n.id, id);
  }

  const zoneIds = new Map(structure.groups.map((g) => [g.id, `zone_${slug(g.id, newId('z'))}`]));
  // 모델이 id를 살짝 바꿔 돌려주는 경우가 있어서 id, slug, 라벨, 순서 순으로 맞춘다.
  const tdList = tradeoffs?.nodes || [];
  const tdById = new Map(tdList.map((t) => [slug(t.id, ''), t.tradeoff]));
  const tradeoffFor = (n, i) =>
    tdById.get(slug(n.id, '')) || tdById.get(slug(n.label, '')) || tdList.find((t) => t.id === n.label)?.tradeoff || (tdList.length === structure.nodes.length ? tdList[i].tradeoff : null);

  const zones = structure.groups
    .filter((g) => structure.nodes.some((n) => n.group === g.id))
    .map((g) => ({
      id: zoneIds.get(g.id),
      type: 'zone',
      position: { x: 0, y: 0 },
      width: 300,
      height: 200,
      zIndex: 0,
      data: { label: g.label, color: '' },
    }));

  const nodes = structure.nodes.map((n, i) => ({
    id: ids.get(n.id),
    type: 'arch',
    position: { x: 0, y: 0 },
    zIndex: 10,
    data: {
      label: n.label,
      kind: KINDS.includes(n.kind) ? n.kind : 'other',
      tech: n.tech,
      group: zoneIds.get(n.group) || '',
      description: n.description,
      inputs: n.inputs || [],
      outputs: n.outputs || [],
      responsibilities: n.responsibilities,
      evidence: n.evidence,
      tradeoff: tradeoffFor(n, i) || emptyTradeoff(),
    },
  }));

  const edgeTradeoff = new Map((tradeoffs?.edges || []).map((t) => [t.index, t.tradeoff]));
  const seen = new Set();
  const edges = [];
  structure.edges.forEach((e, index) => {
    const source = ids.get(e.source);
    const target = ids.get(e.target);
    if (!source || !target || source === target) return;
    const key = `${source}>${target}>${e.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      id: newId('edge'),
      source,
      target,
      type: 'floating',
      data: { label: e.label, protocol: e.protocol, mode: e.mode, tradeoff: edgeTradeoff.get(index) || emptyTradeoff() },
    });
  });

  return { nodes: [...zones, ...nodes], edges };
}

// 화면의 보드를 모델이 읽기 쉬운 짧은 글로 바꾼다. 위치 같은 그리기 정보는 뺀다.
function describeBoard(board) {
  const label = new Map(board.nodes.map((n) => [n.id, n.data?.label || n.id]));
  const zones = board.nodes.filter((n) => n.type === 'zone');
  const blocks = board.nodes.filter((n) => n.type === 'arch');
  const lines = [`# 보드: ${board.name}`];
  if (board.notes?.summary) lines.push(`요약: ${board.notes.summary}`);
  if (zones.length) lines.push(`그룹: ${zones.map((z) => z.data.label).join(', ')}`);
  lines.push('## 블록');
  for (const n of blocks) {
    const d = n.data;
    const group = d.group ? ` [${label.get(d.group) || ''}]` : '';
    lines.push(`- ${d.label}${group} (${d.kind}, ${d.tech || '기술 미기재'}): ${d.description || ''}`);
    if (d.inputs?.length) lines.push(`  입력: ${d.inputs.join(', ')}`);
    if (d.outputs?.length) lines.push(`  출력: ${d.outputs.join(', ')}`);
    if (d.tradeoff?.decision) lines.push(`  결정: ${d.tradeoff.decision}. 이유: ${d.tradeoff.why || ''}`);
  }
  lines.push('## 연결');
  for (const e of board.edges) {
    const d = e.data || {};
    lines.push(`- ${label.get(e.source)} -> ${label.get(e.target)}: ${d.label || ''} (${d.protocol || ''}, ${d.mode || 'sync'})`);
  }
  if (board.notes?.tradeoffs?.length) {
    lines.push('## 전체 수준 결정');
    for (const t of board.notes.tradeoffs) lines.push(`- ${t.topic}: ${t.chosen}. 이유: ${t.why}`);
  }
  return lines.join('\n');
}

export async function reviewBoard(c, board) {
  const { result } = await callJson(c, { system: REVIEW_PROMPT, user: describeBoard(board), schema: REVIEW_SCHEMA, name: 'review', temperature: 0.5 });
  return { ...result, createdAt: new Date().toISOString() };
}

export async function suggestTradeoff(c, board, target) {
  const label = new Map(board.nodes.map((n) => [n.id, n.data?.label || n.id]));
  let focus;
  if (target.type === 'edge') {
    const e = board.edges.find((x) => x.id === target.id);
    if (!e) throw httpError(404, '연결을 찾을 수 없습니다');
    focus = `연결: ${label.get(e.source)} -> ${label.get(e.target)}, ${e.data?.label || ''} (${e.data?.protocol || ''}, ${e.data?.mode || 'sync'})\n이미 적은 내용: ${JSON.stringify(e.data?.tradeoff || {})}`;
  } else {
    const n = board.nodes.find((x) => x.id === target.id);
    if (!n) throw httpError(404, '블록을 찾을 수 없습니다');
    focus = `블록: ${n.data.label} (${n.data.kind}, ${n.data.tech || ''})\n설명: ${n.data.description || ''}\n이미 적은 내용: ${JSON.stringify(n.data.tradeoff || {})}`;
  }
  const { result } = await callJson(c, {
    system: SINGLE_PROMPT,
    user: `${describeBoard(board)}\n\n# 트레이드오프를 쓸 요소\n${focus}`,
    schema: TRADEOFF,
    name: 'tradeoff',
    temperature: 0.4,
  });
  return result;
}
