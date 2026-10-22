import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && <button className="btn btn-ghost btn-sm" onClick={onClose}>닫기</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = '확인', danger, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-text">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>취소</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

const STAGES = [
  ['scan', '코드 폴더 읽기'],
  ['structure', '블록과 연결 추론'],
  ['audit', '빠진 연결 검토'],
  ['tradeoffs', '트레이드오프 작성'],
  ['save', '보드 저장'],
];

export function ImportModal({ project, aiReady, beforeStart, onDone, onClose, onOpenSettings }) {
  const [path, setPath] = useState(project?.sourcePath || '');
  const [browser, setBrowser] = useState(null);
  const [mode, setMode] = useState(project ? 'board' : 'new');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const browse = async (p) => {
    try {
      const res = await api.listDirs(p);
      setBrowser(res);
      setPath(res.path);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    browse(project?.sourcePath || '');
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError('');
    try {
      // 서버가 같은 프로젝트 파일에 보드를 덧붙이므로, 화면에 남은 변경을 먼저 저장한다.
      await beforeStart?.();
      const { jobId } = await api.startImport({ path, mode, projectId: project?.id });
      setJob({ stage: 'scan' });
      timer.current = setInterval(async () => {
        const j = await api.getJob(jobId).catch(() => null);
        if (!j) return;
        setJob(j);
        if (j.stage === 'done') {
          clearInterval(timer.current);
          onDone(j.result);
        } else if (j.stage === 'error') {
          clearInterval(timer.current);
          setError(j.error);
        }
      }, 900);
    } catch (err) {
      setError(err.message);
    }
  };

  const running = job && job.stage !== 'error' && job.stage !== 'done';
  const stageIndex = STAGES.findIndex(([s]) => s === job?.stage);

  return (
    <Modal title="코드에서 아키텍처 만들기" onClose={running ? undefined : onClose} wide>
      {!running ? (
        <>
          <label className="field">
            <span className="field-label">코드 폴더 경로</span>
            <div className="path-row">
              <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && browse(path)} />
              <button className="btn btn-ghost" onClick={() => browse(path)}>열기</button>
            </div>
          </label>
          {browser && (
            <div className="dir-list">
              <button className="dir up" onClick={() => browse(browser.parent)}>.. 상위 폴더</button>
              {browser.dirs.map((d) => (
                <button key={d} className="dir" onClick={() => browse(`${browser.path}/${d}`)}>{d}</button>
              ))}
              {!browser.dirs.length && <p className="hint">하위 폴더가 없습니다</p>}
            </div>
          )}
          {project && (
            <div className="segmented">
              <button className={mode === 'board' ? 'is-on' : ''} onClick={() => setMode('board')}>"{project.name}"에 새 보드로</button>
              <button className={mode === 'new' ? 'is-on' : ''} onClick={() => setMode('new')}>새 프로젝트로</button>
            </div>
          )}
          <p className="hint">
            폴더 구조, 설정 파일(compose, package.json 등), 주요 소스를 읽어 OpenAI로 보냅니다. .env와 키 파일은 읽지 않고, 본문에서 키처럼 보이는 값은 가린 뒤 보냅니다. 보통 30초에서 1분 걸립니다.
          </p>
          {error && <p className="error">{error}</p>}
          {!aiReady && (
            <p className="error">
              OpenAI API 키가 없습니다. <button className="link" onClick={onOpenSettings}>설정 열기</button>
            </p>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>취소</button>
            <button className="btn btn-ai" disabled={!path || !aiReady} onClick={start}>이 폴더로 만들기</button>
          </div>
        </>
      ) : (
        <div className="progress">
          {STAGES.map(([s, label], i) => (
            <div key={s} className={`step${i < stageIndex ? ' done' : i === stageIndex ? ' now' : ''}`}>
              <span className="step-dot" />
              {label}
              {s === 'scan' && job.stats && <span className="step-meta">파일 {job.stats.filesSeen}개 확인, {job.stats.filesRead}개 본문 읽음</span>}
            </div>
          ))}
          <p className="hint">{path}</p>
        </div>
      )}
    </Modal>
  );
}

const MODELS = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o'];

export function SettingsModal({ status, cloud, onSaved, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(status?.model || 'gpt-4.1-mini');
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl || 'https://api.openai.com/v1');
  const [error, setError] = useState('');

  const save = async () => {
    try {
      const body = { model, baseUrl };
      if (apiKey) body.apiKey = apiKey;
      onSaved(await api.saveSettings(body));
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="AI 설정" onClose={onClose}>
      <label className="field">
        <span className="field-label">OpenAI API 키 {status?.hasKey && <em className="ok">설정됨 {status.keyHint}</em>}</span>
        <input type="password" value={apiKey} placeholder={status?.hasKey ? '바꿀 때만 입력' : 'sk-...'} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span className="field-label">모델</span>
        <input value={model} list="models" onChange={(e) => setModel(e.target.value)} />
        <datalist id="models">
          {MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span className="field-label">API 주소</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      {cloud ? (
        <p className="hint">키는 내 계정에만 저장되고 다른 사람은 쓰지 못합니다. AI 기능 비용은 이 키로 청구됩니다.</p>
      ) : (
        <p className="hint">키는 이 컴퓨터의 arch-studio/data/settings.json에만 저장됩니다. Ollama 같은 OpenAI 호환 서버를 쓰려면 주소를 http://localhost:11434/v1 로 바꾸세요.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>취소</button>
        <button className="btn btn-primary" onClick={save}>저장</button>
      </div>
    </Modal>
  );
}

// 클라우드 버전 로그인. 아이디와 비밀번호만 받고, 가입하면 공유된 아키텍처가 내 계정 사본으로 들어온다.
export function LoginScreen({ onDone }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (signup && password !== password2) return setError('비밀번호 확인이 다릅니다');
    setBusy(true);
    try {
      onDone(await (signup ? api.signup : api.login)({ username, password }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark" />
          Arch Studio
        </div>
        <p className="hint">{signup ? '가입하면 공유된 아키텍처가 내 계정에 사본으로 들어옵니다. 내가 고친 내용은 다른 사람 화면에 반영되지 않습니다.' : '아이디와 비밀번호로 로그인하세요.'}</p>
        <label className="field">
          <span className="field-label">아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span className="field-label">비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} required />
        </label>
        {signup && (
          <label className="field">
            <span className="field-label">비밀번호 확인</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {signup && <p className="hint">아이디는 영문, 숫자, _ . - 로 3~32자, 비밀번호는 8자 이상입니다.</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary full" disabled={busy}>{busy ? '확인 중' : signup ? '가입하고 시작' : '로그인'}</button>
        <button type="button" className="btn btn-ghost full" onClick={() => { setMode(signup ? 'login' : 'signup'); setError(''); }}>
          {signup ? '이미 계정이 있어요' : '처음이에요, 가입하기'}
        </button>
      </form>
    </div>
  );
}
