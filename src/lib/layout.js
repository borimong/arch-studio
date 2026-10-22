// 자동 배치는 두 단계다. 그룹 안의 블록을 먼저 배치해 그룹 크기를 정하고,
// 그룹을 하나의 큰 블록으로 보고 그룹끼리 다시 배치한다. 그룹 상자가 서로 겹치지 않는다.
import dagre from '@dagrejs/dagre';

const PAD = { side: 26, top: 50, bottom: 24 };
const DEFAULT = { width: 210, height: 84 };
const GAP = { inner: 36, innerRank: 70, outer: 70, outerRank: 110 };

const sizeOf = (n) => ({ width: n.measured?.width ?? n.width ?? DEFAULT.width, height: n.measured?.height ?? n.height ?? DEFAULT.height });

// 같은 쌍의 중복 연결과 반대 방향 연결은 하나로 합친다. dagre가 이런 그래프에서 가끔 예외를 던진다.
function uniqueLinks(links) {
  const seen = new Set();
  return links.filter((l) => {
    if (l.source === l.target) return false;
    const key = [l.source, l.target].sort().join('>');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dagreLayout(items, links, direction, nodesep, ranksep) {
  try {
    return runDagre(items, uniqueLinks(links), direction, nodesep, ranksep);
  } catch {
    return gridLayout(items, direction);
  }
}

function runDagre(items, links, direction, nodesep, ranksep) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep, ranksep, edgesep: 20, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const it of items) g.setNode(it.id, { width: it.width, height: it.height });
  for (const l of links) if (g.hasNode(l.source) && g.hasNode(l.target)) g.setEdge(l.source, l.target);
  dagre.layout(g);
  const pos = {};
  for (const it of items) {
    const p = g.node(it.id);
    pos[it.id] = { x: p.x - it.width / 2, y: p.y - it.height / 2 };
  }
  return pos;
}

// 그룹 안에 연결이 없으면 한 줄로 길게 늘어서지 않게 격자로 놓는다.
function gridLayout(items, direction) {
  const cols = Math.ceil(Math.sqrt(items.length));
  const w = Math.max(...items.map((i) => i.width));
  const h = Math.max(...items.map((i) => i.height));
  const pos = {};
  items.forEach((it, i) => {
    const a = i % cols;
    const b = Math.floor(i / cols);
    const [c, r] = direction === 'LR' ? [b, a] : [a, b];
    pos[it.id] = { x: c * (w + GAP.inner), y: r * (h + GAP.inner) };
  });
  return pos;
}

function normalize(pos, items) {
  const minX = Math.min(...items.map((i) => pos[i.id].x));
  const minY = Math.min(...items.map((i) => pos[i.id].y));
  const out = {};
  for (const i of items) out[i.id] = { x: pos[i.id].x - minX, y: pos[i.id].y - minY };
  const width = Math.max(...items.map((i) => out[i.id].x + i.width));
  const height = Math.max(...items.map((i) => out[i.id].y + i.height));
  return { pos: out, width, height };
}

export function autoLayout(nodes, edges, direction = 'LR') {
  const blocks = nodes.filter((n) => n.type === 'arch');
  const zoneIds = new Set(nodes.filter((n) => n.type === 'zone').map((z) => z.id));
  const groupOf = (b) => (zoneIds.has(b.data.group) ? b.data.group : `solo:${b.id}`);
  const blockGroup = new Map(blocks.map((b) => [b.id, groupOf(b)]));

  // 1단계: 그룹마다 안쪽 배치
  const groups = new Map();
  for (const b of blocks) {
    const gid = groupOf(b);
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push({ id: b.id, ...sizeOf(b) });
  }
  const inner = new Map();
  for (const [gid, items] of groups) {
    const ids = new Set(items.map((i) => i.id));
    const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const raw = links.length ? dagreLayout(items, links, direction, GAP.inner, GAP.innerRank) : gridLayout(items, direction);
    const laid = normalize(raw, items);
    const solo = gid.startsWith('solo:');
    inner.set(gid, {
      ...laid,
      boxW: laid.width + (solo ? 0 : PAD.side * 2),
      boxH: laid.height + (solo ? 0 : PAD.top + PAD.bottom),
      offX: solo ? 0 : PAD.side,
      offY: solo ? 0 : PAD.top,
    });
  }

  // 2단계: 그룹끼리 배치. 그룹 사이 연결을 모아 dagre에 넣는다.
  const outerItems = [...inner.entries()].map(([gid, v]) => ({ id: gid, width: v.boxW, height: v.boxH }));
  const outerLinks = edges
    .map((e) => ({ source: blockGroup.get(e.source), target: blockGroup.get(e.target) }))
    .filter((l) => l.source && l.target && l.source !== l.target);
  const outer = outerItems.length ? dagreLayout(outerItems, outerLinks, direction, GAP.outer, GAP.outerRank) : {};

  const placed = new Map();
  for (const [gid, v] of inner) {
    const o = outer[gid];
    for (const id of Object.keys(v.pos)) {
      placed.set(id, { x: Math.round(o.x + v.offX + v.pos[id].x), y: Math.round(o.y + v.offY + v.pos[id].y) });
    }
  }

  return nodes.map((n) => {
    if (n.type === 'arch') return { ...n, position: placed.get(n.id) || n.position };
    if (n.type === 'zone' && inner.has(n.id)) {
      const o = outer[n.id];
      const v = inner.get(n.id);
      return { ...n, position: { x: Math.round(o.x), y: Math.round(o.y) }, width: Math.round(v.boxW), height: Math.round(v.boxH) };
    }
    return n;
  });
}

// 블록 중심이 들어가 있는 그룹 중 가장 작은 것을 고른다. 그룹이 겹쳐 있으면 안쪽 그룹이 이긴다.
export function zoneAt(nodes, point) {
  let best = null;
  for (const z of nodes) {
    if (z.type !== 'zone') continue;
    const { width, height } = sizeOf(z);
    const inside = point.x >= z.position.x && point.x <= z.position.x + width && point.y >= z.position.y && point.y <= z.position.y + height;
    if (inside && (!best || width * height < best.area)) best = { id: z.id, area: width * height };
  }
  return best?.id || '';
}

export const centerOf = (n) => {
  const { width, height } = sizeOf(n);
  return { x: n.position.x + width / 2, y: n.position.y + height / 2 };
};
