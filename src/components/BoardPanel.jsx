import { useState } from 'react';
import { uid } from '../lib/api.js';
import { hasTradeoff } from '../lib/kinds.js';
import { ListField, TextField } from './Fields.jsx';

const newDecision = () => ({ id: uid('td'), topic: '', chosen: '', alternatives: [], pros: [], cons: [], why: '' });

function DecisionCard({ item, onChange, onDelete }) {
  const [open, setOpen] = useState(!item.topic);
  const set = (k) => (v) => onChange({ ...item, [k]: v });
  return (
    <div className={`decision${open ? ' is-open' : ''}`}>
      <button className="decision-head" onClick={() => setOpen(!open)}>
        <span className="decision-topic">{item.topic || '새 결정'}</span>
        {item.chosen && <span className="decision-chosen">{item.chosen}</span>}
        <span className="chev">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div className="decision-body">
          <TextField label="주제" value={item.topic} onChange={set('topic')} placeholder="예: 동기 호출 vs 메시지 큐" />
          <TextField label="선택" value={item.chosen} onChange={set('chosen')} />
          <ListField label="대안" value={item.alternatives} onChange={set('alternatives')} rows={2} />
          <ListField label="장점" tone="pro" value={item.pros} onChange={set('pros')} rows={2} />
          <ListField label="단점과 감수한 것" tone="con" value={item.cons} onChange={set('cons')} rows={2} />
          <TextField label="이유" value={item.why} onChange={set('why')} multiline rows={3} />
          <button className="btn btn-ghost btn-sm danger" onClick={onDelete}>이 결정 삭제</button>
        </div>
      )}
    </div>
  );
}

function Review({ review }) {
  const [openQ, setOpenQ] = useState(0);
  return (
    <div className="review">
      <h4>잘한 점</h4>
      <ul className="review-list pro">
        {review.strengths.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h4>약점과 보완</h4>
      {review.risks.map((r, i) => (
        <div key={i} className="risk">
          <b>{r.title}</b>
          <p>{r.detail}</p>
          <p className="risk-fix">보완: {r.suggestion}</p>
        </div>
      ))}
      <h4>예상 꼬리 질문</h4>
      {review.questions.map((q, i) => (
        <div key={i} className={`qa${openQ === i ? ' is-open' : ''}`}>
          <button onClick={() => setOpenQ(openQ === i ? -1 : i)}>Q. {q.question}</button>
          {openQ === i && <p>{q.answer}</p>}
        </div>
      ))}
      <p className="hint">{new Date(review.createdAt).toLocaleString('ko-KR')} 리뷰</p>
    </div>
  );
}

export default function BoardPanel({ board, nodes, edges, onMetaChange, onReview, reviewBusy, aiReady }) {
  const [tab, setTab] = useState('overview');
  const notes = board.notes || { summary: '', story: '', tradeoffs: [] };
  const setNotes = (patch) => onMetaChange({ notes: { ...notes, ...patch } });
  const blocks = nodes.filter((n) => n.type === 'arch');
  const filled = blocks.filter((n) => hasTradeoff(n.data.tradeoff)).length + edges.filter((e) => hasTradeoff(e.data?.tradeoff)).length;

  return (
    <div className="inspector-body">
      <div className="tabs-mini">
        <button className={tab === 'overview' ? 'is-on' : ''} onClick={() => setTab('overview')}>아키텍처 개요</button>
        <button className={tab === 'review' ? 'is-on' : ''} onClick={() => setTab('review')}>
          AI 리뷰{board.review ? '' : ' (없음)'}
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          <div className="stats">
            <div><b>{blocks.length}</b><span>블록</span></div>
            <div><b>{edges.length}</b><span>연결</span></div>
            <div><b>{filled}/{blocks.length + edges.length}</b><span>트레이드오프</span></div>
          </div>
          <TextField label="요약" value={notes.summary} onChange={(v) => setNotes({ summary: v })} multiline rows={3} placeholder="이 시스템이 무엇을 하는지 2~3문장" />
          <TextField
            label="왜 이 구조일 수밖에 없나"
            value={notes.story}
            onChange={(v) => setNotes({ story: v })}
            multiline
            rows={6}
            placeholder="문제, 제약, 선택, 결과 순서로. 면접에서 1분 안에 말할 이야기"
          />
          <div className="section-head">
            <h4>시스템 수준 결정</h4>
            <button className="btn btn-ghost btn-sm" onClick={() => setNotes({ tradeoffs: [...notes.tradeoffs, newDecision()] })}>+ 추가</button>
          </div>
          {notes.tradeoffs.length === 0 && <p className="hint">예: 서비스 분리 vs 모놀리스, 동기 호출 vs 메시지 큐, 업무 규칙을 어디에 둘지</p>}
          {notes.tradeoffs.map((t) => (
            <DecisionCard
              key={t.id}
              item={t}
              onChange={(next) => setNotes({ tradeoffs: notes.tradeoffs.map((x) => (x.id === t.id ? next : x)) })}
              onDelete={() => setNotes({ tradeoffs: notes.tradeoffs.filter((x) => x.id !== t.id) })}
            />
          ))}
          <p className="hint">블록이나 화살표를 클릭하면 그 요소의 트레이드오프를 편집합니다.</p>
        </>
      ) : (
        <>
          <button className="btn btn-ai" disabled={reviewBusy || !aiReady || !blocks.length} onClick={onReview}>
            {reviewBusy ? 'AI가 리뷰하는 중...' : board.review ? '다시 리뷰받기' : '면접관 관점으로 리뷰받기'}
          </button>
          {!aiReady && <p className="hint">설정에서 OpenAI API 키를 넣으면 쓸 수 있습니다.</p>}
          {board.review ? <Review review={board.review} /> : <p className="hint">지금 다이어그램과 트레이드오프 메모를 보고 잘한 점, 약점, 예상 꼬리 질문과 모범 답변을 만듭니다.</p>}
        </>
      )}
    </div>
  );
}
