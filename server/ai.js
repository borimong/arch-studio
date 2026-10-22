// 로컬 서버용 AI 기능. 설정은 data/settings.json과 .env에서 읽고, 공통 로직은 ai-core.js에 있다.
import { readSettings, writeDebug } from './store.js';
import { scanToPrompt } from './scan.js';
import * as core from './ai-core.js';
import { callJson, toBoard, newId, STRUCTURE_PROMPT, STRUCTURE_SCHEMA, AUDIT_PROMPT, TRADEOFF_PROMPT, TRADEOFFS_SCHEMA } from './ai-core.js';

export const KINDS = core.KINDS;

async function config() {
  const s = await readSettings();
  return {
    apiKey: s.apiKey || process.env.OPENAI_API_KEY || '',
    model: s.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    baseUrl: (s.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

export async function aiStatus() {
  return core.aiStatusOf(await config());
}

export const reviewBoard = async (board) => core.reviewBoard(await config(), board);
export const suggestTradeoff = async (board, target) => core.suggestTradeoff(await config(), board, target);

export async function importFromScan(scan, onStage) {
  const c = await config();
  const context = scanToPrompt(scan);

  onStage('structure');
  const { result: draft } = await callJson(c, {
    system: STRUCTURE_PROMPT,
    user: context,
    schema: STRUCTURE_SCHEMA,
    name: 'architecture',
  });

  onStage('audit');
  const { result: structure } = await callJson(c, {
    system: AUDIT_PROMPT,
    user: `# 초안\n${JSON.stringify(draft)}\n\n# 코드 단서\n${context}`,
    schema: STRUCTURE_SCHEMA,
    name: 'architecture',
  });

  onStage('tradeoffs');
  const compact = JSON.stringify({
    nodes: structure.nodes.map(({ id, label, kind, tech, description }) => ({ id, label, kind, tech, description })),
    edges: structure.edges.map((e, index) => ({ index, ...e })),
  });
  const { result: tradeoffs } = await callJson(c, {
    system: TRADEOFF_PROMPT,
    user: `# 정리된 아키텍처\n${compact}\n\n# 코드 단서\n${context}`,
    schema: TRADEOFFS_SCHEMA,
    name: 'tradeoffs',
    temperature: 0.4,
  });

  // 마지막 가져오기의 원본 응답을 남겨 두면 결과가 이상할 때 프롬프트를 고치기 쉽다.
  await writeDebug('last_import.json', { draft, structure, tradeoffs });
  const { nodes, edges } = toBoard(structure, tradeoffs);
  return {
    title: structure.title,
    nodes,
    edges,
    notes: {
      summary: tradeoffs.board.summary || structure.summary,
      story: tradeoffs.board.story,
      tradeoffs: tradeoffs.board.tradeoffs.map((t) => ({ id: newId('td'), ...t })),
    },
  };
}
