import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode } from '@xyflow/react';
import { edgeParams } from '../lib/edgeMath.js';
import { hasTradeoff } from '../lib/kinds.js';

// 동기 호출은 실선, 큐나 이벤트 같은 비동기는 점선으로 그린다.
function FloatingEdge({ id, source, target, data, selected, markerEnd }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s?.measured?.width || !t?.measured?.width) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = edgeParams(s, t);
  const [path, lx, ly] = getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sourcePos, targetX: tx, targetY: ty, targetPosition: targetPos });
  const isAsync = data?.mode === 'async';
  const text = [data?.label, data?.protocol && data.protocol !== data?.label ? data.protocol : ''].filter(Boolean).join(' / ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={20}
        style={{ stroke: selected ? '#4f46e5' : '#64748b', strokeWidth: selected ? 2.4 : 1.6, strokeDasharray: isAsync ? '7 5' : undefined }}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label${selected ? ' is-selected' : ''}${isAsync ? ' is-async' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {text}
            {hasTradeoff(data?.tradeoff) && <span className="edge-td" />}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(FloatingEdge);
