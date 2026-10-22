// 화살표가 블록의 고정 핸들이 아니라 두 블록을 잇는 직선과 테두리가 만나는 점에서 시작하고 끝나게 한다.
// React Flow 공식 floating edge 예제의 계산을 그대로 따른다.
import { Position } from '@xyflow/react';

function intersection(node, other) {
  const { width: w0, height: h0 } = node.measured;
  const p = node.internals.positionAbsolute;
  const o = other.internals.positionAbsolute;
  const w = w0 / 2;
  const h = h0 / 2;
  const x2 = p.x + w;
  const y2 = p.y + h;
  const x1 = o.x + other.measured.width / 2;
  const y1 = o.y + other.measured.height / 2;
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

function sideOf(node, point) {
  const p = node.internals.positionAbsolute;
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (px <= Math.round(p.x) + 1) return Position.Left;
  if (px >= Math.round(p.x + node.measured.width) - 1) return Position.Right;
  if (py <= Math.round(p.y) + 1) return Position.Top;
  if (py >= Math.round(p.y + node.measured.height) - 1) return Position.Bottom;
  return Position.Top;
}

export function edgeParams(source, target) {
  const s = intersection(source, target);
  const t = intersection(target, source);
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y, sourcePos: sideOf(source, s), targetPos: sideOf(target, t) };
}
