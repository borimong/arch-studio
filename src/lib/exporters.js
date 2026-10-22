// 면접 준비용 Markdown과 백업용 JSON을 만든다.
import { kindOf, hasTradeoff } from './kinds.js';

const list = (title, items) => (items?.length ? `- ${title}: ${items.join(', ')}\n` : '');

function tradeoffMd(t) {
  if (!hasTradeoff(t)) return '';
  return `${t.decision ? `- 결정: ${t.decision}\n` : ''}${list('대안', t.alternatives)}${list('장점', t.pros)}${list('단점', t.cons)}${t.why ? `- 이유: ${t.why}\n` : ''}`;
}

export function boardToMarkdown(project, board) {
  const label = new Map(board.nodes.map((n) => [n.id, n.data?.label]));
  const notes = board.notes || {};
  let md = `# ${project.name}: ${board.name}\n\n`;
  if (notes.summary) md += `## 요약\n\n${notes.summary}\n\n`;
  if (notes.story) md += `## 왜 이 구조일 수밖에 없나\n\n${notes.story}\n\n`;
  if (notes.tradeoffs?.length) {
    md += '## 시스템 수준 결정\n\n';
    for (const t of notes.tradeoffs) {
      md += `### ${t.topic}\n\n- 선택: ${t.chosen}\n${list('대안', t.alternatives)}${list('장점', t.pros)}${list('단점', t.cons)}${t.why ? `- 이유: ${t.why}\n` : ''}\n`;
    }
  }
  const zones = board.nodes.filter((n) => n.type === 'zone');
  const blocks = board.nodes.filter((n) => n.type === 'arch');
  md += '## 블록\n\n';
  const groups = [...zones.map((z) => [z.id, z.data.label]), ['', '그룹 없음']];
  for (const [zid, zlabel] of groups) {
    const members = blocks.filter((b) => (b.data.group || '') === zid);
    if (!members.length) continue;
    md += `### ${zlabel}\n\n`;
    for (const b of members) {
      const d = b.data;
      md += `#### ${d.label} (${kindOf(d.kind).label}${d.tech ? `, ${d.tech}` : ''})\n\n`;
      if (d.description) md += `${d.description}\n\n`;
      if (d.inputs?.length) md += `- 입력:\n${d.inputs.map((x) => `  - ${x}`).join('\n')}\n`;
      if (d.outputs?.length) md += `- 출력:\n${d.outputs.map((x) => `  - ${x}`).join('\n')}\n`;
      if (d.inputs?.length || d.outputs?.length) md += '\n';
      if (d.responsibilities?.length) md += `${d.responsibilities.map((r) => `- ${r}`).join('\n')}\n\n`;
      const t = tradeoffMd(d.tradeoff);
      if (t) md += `${t}\n`;
    }
  }
  if (board.edges.length) {
    md += '## 연결\n\n';
    for (const e of board.edges) {
      const d = e.data || {};
      md += `- ${label.get(e.source)} → ${label.get(e.target)}: ${d.label || ''}${d.protocol ? ` (${d.protocol}, ${d.mode === 'async' ? '비동기' : '동기'})` : ''}\n`;
      const t = tradeoffMd(d.tradeoff);
      if (t) md += t.split('\n').filter(Boolean).map((l) => `  ${l}`).join('\n') + '\n';
    }
    md += '\n';
  }
  if (board.review) {
    md += '## AI 리뷰\n\n### 잘한 점\n\n' + board.review.strengths.map((s) => `- ${s}`).join('\n') + '\n\n### 약점과 보완\n\n';
    md += board.review.risks.map((r) => `- ${r.title}: ${r.detail} 보완: ${r.suggestion}`).join('\n') + '\n\n### 예상 꼬리 질문\n\n';
    md += board.review.questions.map((q) => `**Q. ${q.question}**\n\n${q.answer}\n`).join('\n');
  }
  return md;
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
