import { memo } from 'react';
import { NodeResizer } from '@xyflow/react';

// 계층이나 배포 경계를 나타내는 그룹 상자. 이름표를 잡고 끌면 안의 블록도 같이 움직인다.
function ZoneNode({ data, selected }) {
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={180} minHeight={110} color="#4f46e5" />
      <div className={`zone${selected ? ' is-selected' : ''}`} style={{ '--z': data.color || '#6366f1' }}>
        <div className="zone-tab">{data.label || '그룹'}</div>
      </div>
    </>
  );
}

export default memo(ZoneNode);
