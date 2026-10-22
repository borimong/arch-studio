import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { kindOf, hasTradeoff } from '../lib/kinds.js';

const SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
];

// 아키텍처 블록. 네 변의 점을 끌면 다른 블록으로 화살표가 생긴다.
function ArchNode({ data, selected }) {
  const k = kindOf(data.kind);
  return (
    <div className={`arch-node${selected ? ' is-selected' : ''}`} style={{ '--c': k.color }}>
      {SIDES.map(([id, pos]) => (
        <Handle key={id} id={id} type="source" position={pos} className="arch-handle" />
      ))}
      <div className="arch-node-head">
        <span className="arch-badge">{k.short}</span>
        <span className="arch-kind">{k.label}</span>
        {hasTradeoff(data.tradeoff) && <span className="arch-td" title="트레이드오프 작성됨" />}
      </div>
      <div className="arch-label">{data.label || '이름 없음'}</div>
      {data.tech && <div className="arch-tech">{data.tech}</div>}
    </div>
  );
}

export default memo(ArchNode);
