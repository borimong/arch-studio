import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from './components/Editor.jsx';
import { ConfirmModal, ImportModal, LoginScreen, SettingsModal } from './components/Modals.jsx';
import { api, uid } from './lib/api.js';
import { boardToMarkdown, download } from './lib/exporters.js';

const LAST_KEY = 'arch-studio:last-project';
const remember = (id) => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // 저장소를 못 쓰는 환경이면 마지막 프로젝트 기억만 건너뛴다.
  }
};
const recall = () => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

const blankBoard = (name) => ({ id: uid('board'), name, nodes: [], edges: [], notes: { summary: '', story: '', tradeoffs: [] }, review: null, needsLayout: false });

function InlineEdit({ value, onSave, className }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (!editing) {
    return (
      <span className={className} onDoubleClick={() => setEditing(true)} title="더블클릭해서 이름 바꾸기">
        {value}
      </span>
    );
  }
  const done = () => {
    setEditing(false);
    if (text.trim() && text !== value) onSave(text.trim());
  };
  return <input className={`inline-edit ${className}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && done()} />;
}

// 로컬 서버면 바로 편집기를 열고, Cloudflare 배포본이면 로그인한 뒤에 연다.
export default function App() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.me().then(setMe, () => setMe({ mode: 'local', user: null }));
  }, []);
  if (!me) return null;
  if (me.mode === 'cloud' && !me.user) return <LoginScreen onDone={setMe} />;
  const logout = async () => {
    await api.logout().catch(() => null);
    window.location.reload();
  };
  return <Studio me={me} onLogout={logout} />;
}

function Studio({ me, onLogout }) {
  const cloud = me.mode === 'cloud';
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [status, setStatus] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [saveState, setSaveState] = useState('saved');
  const [menu, setMenu] = useState(false);
  const fileInput = useRef(null);

  const notify = useCallback((text, tone = 'info') => {
    setToast({ text, tone, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshList = useCallback(async () => setProjects(await api.listProjects()), []);

  // 저장은 마지막 변경 뒤 0.7초에 한 번만 한다. 페이지를 닫기 직전 변경은 sendBeacon 대신 keepalive로 보낸다.
  const projectRef = useRef(null);
  const saveTimer = useRef(null);
  // baseRef는 서버에 마지막으로 저장된 시각이다. 저장은 하나씩 순서대로 보내서 같은 base로 두 번 보내지 않는다.
  const baseRef = useRef(null);
  const saving = useRef(Promise.resolve());
  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    saving.current = saving.current.then(() => saveOnce());
    return saving.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveOnce = async () => {
    const p = projectRef.current;
    if (!p) return;
    setSaveState('saving');
    try {
      const { updatedAt } = await api.saveProject(p, baseRef.current);
      baseRef.current = updatedAt;
      setSaveState(saveTimer.current ? 'dirty' : 'saved');
    } catch (err) {
      if (err.status === 409) {
        // 다른 창이 먼저 저장했다. 이 창의 미저장 변경 대신 서버의 최신본을 불러온다.
        reloadRef.current?.(p.id);
        notify('다른 창에서 바뀐 내용이 있어 최신 상태를 불러왔습니다', 'error');
        return;
      }
      setSaveState('error');
      notify(`저장 실패: ${err.message}`, 'error');
    }
  };
  const reloadRef = useRef(null);
  // 서버에서 프로젝트를 새로 받을 때마다 올린다. 편집기 key에 넣어, 다시 불러온 보드로 편집기를 새로 만든다.
  // 그러지 않으면 편집기가 예전 블록을 들고 있다가 다음 저장 때 최신본을 덮어쓴다.
  const [loadNo, setLoadNo] = useState(0);

  const update = useCallback(
    (fn) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = fn(structuredClone(prev));
        projectRef.current = next;
        return next;
      });
      setSaveState('dirty');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveNow, 700);
    },
    [saveNow],
  );

  useEffect(() => {
    const onLeave = () => {
      if (saveTimer.current && projectRef.current) {
        const p = projectRef.current;
        fetch(`/api/projects/${p.id}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, _base: baseRef.current }) });
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const open = useCallback(
    async (id, boardId, { skipSave = false } = {}) => {
      if (saveTimer.current && !skipSave) await saveNow();
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      try {
        const p = await api.getProject(id);
        if (boardId) p.activeBoardId = boardId;
        if (!p.boards.some((b) => b.id === p.activeBoardId)) p.activeBoardId = p.boards[0].id;
        projectRef.current = p;
        baseRef.current = p.updatedAt;
        setProject(p);
        setLoadNo((n) => n + 1);
        setSaveState('saved');
        remember(id);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify, saveNow],
  );

  reloadRef.current = (id) => open(id, projectRef.current?.activeBoardId, { skipSave: true });

  // 창으로 돌아왔을 때 다른 창에서 저장된 최신본이 있으면 불러온다.
  useEffect(() => {
    const onVisible = async () => {
      const p = projectRef.current;
      if (document.visibilityState !== 'visible' || !p || saveTimer.current) return;
      const list = await api.listProjects().catch(() => null);
      const item = list?.find((x) => x.id === p.id);
      if (item && item.updatedAt !== baseRef.current) reloadRef.current(p.id);
      if (list) setProjects(list);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  useEffect(() => {
    (async () => {
      setStatus(await api.getSettings().catch(() => null));
      const list = await api.listProjects();
      setProjects(list);
      const last = recall();
      const target = list.find((p) => p.id === last) || list[0];
      if (target) open(target.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (saveState === 'saved') refreshList();
  }, [saveState, refreshList]);

  const createProject = async () => {
    const p = await api.createProject({ name: '새 프로젝트' });
    await refreshList();
    open(p.id);
  };

  const board = project?.boards.find((b) => b.id === project.activeBoardId);

  const onBoardChange = useCallback(
    (boardId, patch) =>
      update((p) => {
        const b = p.boards.find((x) => x.id === boardId);
        if (b) Object.assign(b, patch);
        return p;
      }),
    [update],
  );
  const boardId = board?.id;
  const onEditorChange = useCallback((patch) => onBoardChange(boardId, patch), [onBoardChange, boardId]);

  const addBoard = (copy) => {
    setMenu(false);
    update((p) => {
      const src = p.boards.find((b) => b.id === p.activeBoardId);
      const b = copy ? { ...structuredClone(src), id: uid('board'), name: `${src.name} 대안`, review: null } : blankBoard(`보드 ${p.boards.length + 1}`);
      p.boards.push(b);
      p.activeBoardId = b.id;
      return p;
    });
  };

  const removeBoard = (id) =>
    setModal({
      type: 'confirm',
      title: '보드 삭제',
      message: '이 보드의 블록, 연결, 트레이드오프 메모가 모두 지워집니다. 되돌릴 수 없습니다.',
      danger: true,
      confirmLabel: '삭제',
      onConfirm: () =>
        update((p) => {
          p.boards = p.boards.filter((b) => b.id !== id);
          if (p.activeBoardId === id) p.activeBoardId = p.boards[0].id;
          return p;
        }),
    });

  const removeProject = (item) =>
    setModal({
      type: 'confirm',
      title: '프로젝트 삭제',
      message: cloud
        ? `"${item.name}" 프로젝트를 내 목록에서 지웁니다. 다른 사람의 사본에는 영향이 없습니다.`
        : `"${item.name}" 프로젝트를 목록에서 지웁니다. 파일은 arch-studio/data/trash로 옮겨지므로 필요하면 되살릴 수 있습니다.`,
      danger: true,
      confirmLabel: '삭제',
      onConfirm: async () => {
        await api.deleteProject(item.id);
        if (project?.id === item.id) {
          projectRef.current = null;
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
          setProject(null);
        }
        const list = await api.listProjects();
        setProjects(list);
        if (project?.id === item.id && list[0]) open(list[0].id);
      },
    });

  const importJson = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.boards)) throw new Error('Arch Studio 프로젝트 JSON이 아닙니다');
      const p = await api.createProject({ name: data.name, boards: data.boards, sourcePath: data.sourcePath });
      await refreshList();
      open(p.id);
      notify('프로젝트를 가져왔습니다');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          Arch Studio
        </div>
        {!cloud && <button className="btn btn-ai full" onClick={() => setModal({ type: 'import' })}>코드에서 아키텍처 만들기</button>}
        <button className="btn full" onClick={createProject}>+ 빈 프로젝트</button>
        <div className="side-title">프로젝트</div>
        <div className="project-list">
          {projects.map((p) => (
            <div key={p.id} className={`project-item${project?.id === p.id ? ' is-on' : ''}`} onClick={() => project?.id !== p.id && open(p.id)}>
              <div className="project-name">{p.name}</div>
              <div className="project-meta">
                보드 {p.boards}개{p.sourcePath ? `, ${p.sourcePath.split('/').slice(-1)[0]}` : ''}
              </div>
              <button
                className="project-del"
                title="삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  removeProject(p);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {!projects.length && <p className="hint">아직 프로젝트가 없습니다.</p>}
        </div>
        <div className="side-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => fileInput.current.click()}>JSON 가져오기</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'settings' })}>
            AI 설정 <span className={`led${status?.hasKey ? ' on' : ''}`} />
          </button>
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={(e) => e.target.files[0] && importJson(e.target.files[0])} />
        </div>
        {cloud && (
          <div className="side-user">
            <span>{me.user.username}</span>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>로그아웃</button>
          </div>
        )}
      </aside>

      <main className="main">
        {project && board ? (
          <>
            <header className="topbar">
              <InlineEdit className="project-title" value={project.name} onSave={(name) => update((p) => ({ ...p, name }))} />
              <div className="board-tabs">
                {project.boards.map((b) => (
                  <div key={b.id} className={`board-tab${b.id === board.id ? ' is-on' : ''}`} onClick={() => b.id !== board.id && update((p) => ({ ...p, activeBoardId: b.id }))}>
                    <InlineEdit value={b.name} onSave={(name) => update((p) => ({ ...p, boards: p.boards.map((x) => (x.id === b.id ? { ...x, name } : x)) }))} />
                    {project.boards.length > 1 && (
                      <button
                        className="tab-x"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBoard(b.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <div className="tab-add">
                  <button className="btn btn-ghost btn-sm" onClick={() => setMenu(!menu)}>+ 보드</button>
                  {menu && (
                    <div className="menu" onMouseLeave={() => setMenu(false)}>
                      <button onClick={() => addBoard(true)}>현재 보드 복제해서 대안 만들기</button>
                      <button onClick={() => addBoard(false)}>빈 보드</button>
                      {!cloud && <button onClick={() => { setMenu(false); setModal({ type: 'import' }); }}>코드에서 새로 분석</button>}
                    </div>
                  )}
                </div>
              </div>
              <div className="spacer" />
              <span className={`save-state ${saveState}`}>{saveState === 'saved' ? '저장됨' : saveState === 'error' ? '저장 실패' : '저장 중'}</span>
              <button className="btn btn-sm" onClick={() => download(`${project.name}_${board.name}.md`, boardToMarkdown(project, board), 'text/markdown')}>면접 노트 MD</button>
              <button className="btn btn-sm btn-ghost" onClick={() => download(`${project.name}.json`, JSON.stringify(project, null, 2), 'application/json')}>JSON</button>
            </header>
            <Editor
              key={`${project.id}:${board.id}:${loadNo}`}
              board={board}
              title={`${project.name}_${board.name}`}
              onChange={onEditorChange}
              onMetaChange={onEditorChange}
              onImport={cloud ? null : () => setModal({ type: 'import' })}
              notify={notify}
              aiReady={Boolean(status?.hasKey || /localhost|127\.0\.0\.1/.test(status?.baseUrl || ''))}
            />
          </>
        ) : (
          <div className="welcome">
            <h2>아키텍처를 블록으로 정리하세요</h2>
            <p>{cloud ? '왼쪽 목록에서 프로젝트를 고르거나 빈 프로젝트로 시작하세요. 블록을 끌어다 놓고 화살표로 이으면 됩니다.' : '내 컴퓨터의 코드 폴더를 고르면 AI가 서비스, 데이터 흐름, 기술 선택의 트레이드오프까지 초안을 만들어 줍니다. 그다음 끌어다 놓으며 다듬으면 됩니다.'}</p>
            <div className="welcome-actions">
              {!cloud && <button className="btn btn-ai" onClick={() => setModal({ type: 'import' })}>코드에서 아키텍처 만들기</button>}
              <button className="btn" onClick={createProject}>빈 프로젝트로 시작</button>
            </div>
          </div>
        )}
      </main>

      {modal?.type === 'import' && (
        <ImportModal
          project={project}
          aiReady={Boolean(status?.hasKey || /localhost|127\.0\.0\.1/.test(status?.baseUrl || ''))}
          beforeStart={saveNow}
          onClose={() => setModal(null)}
          onOpenSettings={() => setModal({ type: 'settings' })}
          onDone={async ({ projectId, boardId }) => {
            setModal(null);
            await refreshList();
            await open(projectId, boardId);
            notify('AI가 아키텍처 초안을 만들었습니다. 블록을 끌어 다듬어 보세요.');
          }}
        />
      )}
      {modal?.type === 'settings' && <SettingsModal status={status} cloud={cloud} onSaved={setStatus} onClose={() => setModal(null)} />}
      {modal?.type === 'confirm' && <ConfirmModal {...modal} onClose={() => setModal(null)} />}
      {toast && <div className={`toast ${toast.tone}`}>{toast.text}</div>}
    </div>
  );
}
