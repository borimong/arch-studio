import { KINDS, ZONE_COLORS } from '../lib/kinds.js';
import { ListField, TextField, TradeoffEditor } from './Fields.jsx';

const PROTOCOLS = ['HTTP REST', 'GraphQL', 'gRPC', 'WebSocket', 'SSE', 'AMQP', 'Kafka', 'SQL', 'Redis', 'MCP', 'S3 API', 'OAuth', 'SMTP'];

export function NodeInspector({ node, zones, onChange, onAi, aiBusy, aiReady, onDuplicate, onDelete }) {
  const d = node.data;
  const set = (k) => (v) => onChange({ [k]: v });
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="dot" style={{ background: KINDS[d.kind]?.color }} />
        블록
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onDuplicate} title="복제 (Cmd+D)">복제</button>
        <button className="btn btn-ghost btn-sm danger" onClick={onDelete}>삭제</button>
      </div>
      <TextField label="이름" value={d.label} onChange={set('label')} />
      <div className="field-row">
        <label className="field">
          <span className="field-label">종류</span>
          <select value={d.kind} onChange={(e) => onChange({ kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">그룹</span>
          <select value={d.group || ''} onChange={(e) => onChange({ group: e.target.value })}>
            <option value="">없음</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.data.label}</option>
            ))}
          </select>
        </label>
      </div>
      <TextField label="기술 스택" value={d.tech} onChange={set('tech')} placeholder="예: Spring Boot 3, Java 21" />
      <TextField label="설명" value={d.description} onChange={set('description')} multiline rows={2} />
      <ListField label="입력" value={d.inputs} onChange={set('inputs')} placeholder={'받는 요청이나 데이터, 한 줄에 하나씩\n예: 재계획 요청(shootDayId, 변경 내용)'} rows={2} />
      <ListField label="출력" value={d.outputs} onChange={set('outputs')} placeholder={'내보내는 결과나 데이터, 한 줄에 하나씩\n예: 202 Accepted + taskId'} rows={2} />
      <ListField label="책임" value={d.responsibilities} onChange={set('responsibilities')} placeholder="한 줄에 하나씩" rows={2} />
      <TradeoffEditor value={d.tradeoff} onChange={set('tradeoff')} onAi={onAi} busy={aiBusy} aiReady={aiReady} />
      {d.evidence?.length > 0 && (
        <div className="evidence">
          <span className="field-label">근거 파일</span>
          {d.evidence.map((p) => (
            <code key={p}>{p}</code>
          ))}
        </div>
      )}
    </div>
  );
}

export function ZoneInspector({ node, memberCount, onChange, onDelete }) {
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="dot" style={{ background: node.data.color || '#6366f1' }} />
        그룹
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm danger" onClick={onDelete}>삭제</button>
      </div>
      <TextField label="이름" value={node.data.label} onChange={(v) => onChange({ label: v })} />
      <div className="field">
        <span className="field-label">색</span>
        <div className="swatches">
          {ZONE_COLORS.map((c) => (
            <button key={c} className={`swatch${(node.data.color || '#6366f1') === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => onChange({ color: c })} />
          ))}
        </div>
      </div>
      <TextField label="메모" value={node.data.note} onChange={(v) => onChange({ note: v })} multiline rows={3} placeholder="이 경계를 나눈 이유" />
      <p className="hint">블록 {memberCount}개가 들어 있습니다. 블록을 상자 안으로 끌어 놓으면 그룹에 들어가고, 이름표를 끌면 안의 블록이 같이 움직입니다.</p>
    </div>
  );
}

export function EdgeInspector({ edge, sourceLabel, targetLabel, onChange, onReverse, onAi, aiBusy, aiReady, onDelete }) {
  const d = edge.data || {};
  const set = (k) => (v) => onChange({ [k]: v });
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        연결
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onReverse}>방향 뒤집기</button>
        <button className="btn btn-ghost btn-sm danger" onClick={onDelete}>삭제</button>
      </div>
      <div className="edge-route">
        <b>{sourceLabel}</b>
        <span>→</span>
        <b>{targetLabel}</b>
      </div>
      <TextField label="라벨" value={d.label} onChange={set('label')} placeholder="예: 작업 발행" />
      <TextField label="프로토콜" value={d.protocol} onChange={set('protocol')} list="protocols" placeholder="예: AMQP" />
      <datalist id="protocols">
        {PROTOCOLS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="field">
        <span className="field-label">방식</span>
        <div className="segmented">
          <button className={d.mode !== 'async' ? 'is-on' : ''} onClick={() => onChange({ mode: 'sync' })}>동기(응답 대기)</button>
          <button className={d.mode === 'async' ? 'is-on' : ''} onClick={() => onChange({ mode: 'async' })}>비동기(큐, 이벤트)</button>
        </div>
      </div>
      <TradeoffEditor value={d.tradeoff} onChange={set('tradeoff')} onAi={onAi} busy={aiBusy} aiReady={aiReady} />
    </div>
  );
}
