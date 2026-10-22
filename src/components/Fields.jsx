import { useEffect, useState } from 'react';

const joined = (v) => (v || []).join('\n');

// 오른쪽 패널 폭에서 한 줄에 들어가는 영문 글자 수 어림값이다. 한글은 영문 두 글자 폭으로 센다.
const LINE_WIDTH = 36;
const visualRows = (text) =>
  text.split('\n').reduce((sum, line) => {
    const width = [...line].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 2 : 1), 0);
    return sum + Math.max(1, Math.ceil(width / LINE_WIDTH));
  }, 0);

// 한 줄에 항목 하나씩 적는 목록 입력. 입력 중 빈 줄은 유지하고, 저장할 때만 빈 항목을 뺀다.
export function ListField({ label, value, onChange, placeholder, tone, rows = 3 }) {
  const [text, setText] = useState(joined(value));

  useEffect(() => {
    const clean = text.split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
    if (clean !== joined(value)) setText(joined(value));
    // 바깥에서 값이 바뀐 경우(AI 채우기, 실행 취소)에만 다시 맞춘다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className={`field${tone ? ` tone-${tone}` : ''}`}>
      <span className="field-label">{label}</span>
      <textarea
        rows={Math.max(rows, visualRows(text))}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean));
        }}
      />
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, multiline, rows = 3, list }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? (
        <textarea rows={rows} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value || ''} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

// 블록과 연결이 같이 쓰는 트레이드오프 편집기.
export function TradeoffEditor({ value, onChange, onAi, busy, aiReady }) {
  const t = value || {};
  const set = (k) => (v) => onChange({ ...t, [k]: v });
  const filled = Boolean(t.decision || t.why || t.pros?.length);
  return (
    <section className="tradeoff">
      <div className="tradeoff-head">
        <h4>트레이드오프</h4>
        <button className="btn btn-ai btn-sm" disabled={busy || !aiReady} onClick={onAi} title={aiReady ? '' : '설정에서 API 키를 넣으면 쓸 수 있습니다'}>
          {busy ? 'AI 작성 중...' : filled ? 'AI로 보강' : 'AI로 채우기'}
        </button>
      </div>
      <TextField label="결정" value={t.decision} onChange={set('decision')} placeholder="예: 작업 분배에 RabbitMQ 사용" />
      <ListField label="대안" value={t.alternatives} onChange={set('alternatives')} placeholder={'한 줄에 하나씩\n예: Kafka\n예: DB 폴링'} rows={2} />
      <ListField label="장점" tone="pro" value={t.pros} onChange={set('pros')} placeholder="이 선택으로 얻는 것" />
      <ListField label="단점과 감수한 것" tone="con" value={t.cons} onChange={set('cons')} placeholder="이 선택으로 잃거나 떠안는 것" />
      <TextField label="왜 이걸 골랐나" value={t.why} onChange={set('why')} multiline rows={3} placeholder="이 프로젝트 맥락에서 맞는 이유" />
    </section>
  );
}
