import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  ConnectionMode,
  MarkerType,
  addEdge,
  useEdgesState,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import ArchNode from './ArchNode.jsx';
import ZoneNode from './ZoneNode.jsx';
import FloatingEdge from './FloatingEdge.jsx';
import { NodeInspector, ZoneInspector, EdgeInspector } from './Inspector.jsx';
import BoardPanel from './BoardPanel.jsx';
import { KINDS, PALETTE, ZONE_COLORS, emptyTradeoff, kindOf } from '../lib/kinds.js';
import { autoLayout, centerOf, zoneAt } from '../lib/layout.js';
import { api, uid } from '../lib/api.js';

const nodeTypes = { arch: ArchNode, zone: ZoneNode };
const edgeTypes = { floating: FloatingEdge };
const MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' };
const DEFAULT_EDGE = { type: 'floating', markerEnd: MARKER };

const normalizeNodes = (nodes) => (nodes || []).map((n) => ({ ...n, zIndex: n.type === 'zone' ? 0 : 10, selected: false }));
const normalizeEdges = (edges) => (edges || []).map((e) => ({ ...e, type: 'floating', markerEnd: MARKER, selected: false }));

// 저장할 때는 React Flow가 붙이는 측정값과 선택 상태를 뺀다.
const serializeNodes = (nodes) =>
  nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: n.data,
    ...(n.type === 'zone' ? { width: Math.round(n.width ?? n.measured?.width ?? 300), height: Math.round(n.height ?? n.measured?.height ?? 200) } : {}),
  }));
const serializeEdges = (edges) => edges.map(({ id, source, target, sourceHandle, targetHandle, data }) => ({ id, source, target, sourceHandle, targetHandle, data }));

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

function newArchNode(kind, position, group = '') {
  return {
    id: uid('node'),
    type: 'arch',
    position,
    zIndex: 10,
    data: { label: kindOf(kind).label, kind, tech: '', group, description: '', inputs: [], outputs: [], responsibilities: [], evidence: [], tradeoff: emptyTradeoff() },
  };
}

function newZone(position, index) {
  return { id: uid('zone'), type: 'zone', position, width: 380, height: 240, zIndex: 0, data: { label: '새 그룹', color: ZONE_COLORS[index % ZONE_COLORS.length] } };
}

function Palette({ onAdd }) {
  const start = (e, kind) => {
    e.dataTransfer.setData('application/arch-kind', kind);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <aside className="palette">
      <div className="palette-title">블록</div>
      <p className="palette-hint">캔버스로 끌어 놓거나 클릭</p>
      <div className="palette-item zone-item" draggable onDragStart={(e) => start(e, 'zone')} onClick={() => onAdd('zone')}>
        <span className="palette-zone" />
        그룹 상자
      </div>
      {PALETTE.map((k) => (
        <div key={k} className="palette-item" draggable onDragStart={(e) => start(e, k)} onClick={() => onAdd(k)} style={{ '--c': KINDS[k].color }}>
          <span className="palette-badge">{KINDS[k].short}</span>
          {KINDS[k].label}
        </div>
      ))}
    </aside>
  );
}

function EditorInner({ board, title, onChange, onMetaChange, onImport, notify, aiReady }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(normalizeNodes(board.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(normalizeEdges(board.edges));
  const rf = useReactFlow();
  const initialized = useNodesInitialized();
  const [direction, setDirection] = useState(board.direction || 'LR');
  const [busy, setBusy] = useState({ tradeoff: false, review: false });
  const wrapper = useRef(null);

  // 실행 취소용 스냅샷. 끌기 시작, 연결, 추가, 삭제, 편집 직전에 찍는다.
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };
  const past = useRef([]);
  const future = useRef([]);
  const lastSnap = useRef(0);
  const snapshot = useCallback((throttle = false) => {
    if (throttle && Date.now() - lastSnap.current < 1200) return;
    lastSnap.current = Date.now();
    past.current.push(structuredClone({ nodes: serializeNodes(latest.current.nodes), edges: serializeEdges(latest.current.edges) }));
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  }, []);
  const restore = useCallback(
    (from, to) => {
      const prev = from.current.pop();
      if (!prev) return;
      to.current.push(structuredClone({ nodes: serializeNodes(latest.current.nodes), edges: serializeEdges(latest.current.edges) }));
      setNodes(normalizeNodes(prev.nodes));
      setEdges(normalizeEdges(prev.edges));
    },
    [setNodes, setEdges],
  );
  const undo = useCallback(() => restore(past, future), [restore]);
  const redo = useCallback(() => restore(future, past), [restore]);

  // 변경은 모아서 부모에게 넘기고, 보드를 떠날 때 남은 변경을 바로 넘긴다.
  const pending = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    clearTimeout(pending.current?.timer);
    const flush = () => {
      pending.current = null;
      onChangeRef.current({ nodes: serializeNodes(latest.current.nodes), edges: serializeEdges(latest.current.edges) });
    };
    pending.current = { timer: setTimeout(flush, 400), flush };
  }, [nodes, edges]);
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        pending.current.flush();
      }
    },
    [],
  );

  const fit = useCallback(() => setTimeout(() => rf.fitView({ padding: 0.08, duration: 350 }), 150), [rf]);

  const layout = useCallback(
    (dir = direction) => {
      snapshot();
      setNodes((ns) => {
        try {
          return autoLayout(ns, latest.current.edges, dir);
        } catch (err) {
          notify(`자동 정리 실패: ${err.message}`, 'error');
          return ns;
        }
      });
      fit();
    },
    [direction, fit, notify, setNodes, snapshot],
  );

  // AI가 만든 보드는 블록 크기를 잰 뒤에 한 번 자동 배치한다.
  const [needsLayout, setNeedsLayout] = useState(Boolean(board.needsLayout));
  useEffect(() => {
    if (!needsLayout || !initialized) return;
    setNodes((ns) => autoLayout(ns, latest.current.edges, direction));
    setNeedsLayout(false);
    onMetaChange({ needsLayout: false });
    fit();
  }, [needsLayout, initialized, direction, fit, onMetaChange, setNodes]);

  useEffect(() => {
    if (!board.needsLayout && nodes.length) fit();
    // 처음 열 때만 화면에 맞춘다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAt = useCallback(
    (kind, position) => {
      snapshot();
      const zones = latest.current.nodes.filter((n) => n.type === 'zone');
      const node =
        kind === 'zone'
          ? newZone({ x: position.x - 190, y: position.y - 120 }, zones.length)
          : newArchNode(kind, { x: position.x - 105, y: position.y - 40 }, zoneAt(latest.current.nodes, position));
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
      setEdges((es) => es.map((e) => ({ ...e, selected: false })));
    },
    [setEdges, setNodes, snapshot],
  );

  const addCenter = useCallback(
    (kind) => {
      const rect = wrapper.current.getBoundingClientRect();
      const jitter = () => (Math.random() - 0.5) * 60;
      addAt(kind, rf.screenToFlowPosition({ x: rect.left + rect.width / 2 + jitter(), y: rect.top + rect.height / 2 + jitter() }));
    },
    [addAt, rf],
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('application/arch-kind');
      if (kind) addAt(kind, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addAt, rf],
  );

  const onConnect = useCallback(
    (params) => {
      snapshot();
      const edge = { ...params, ...DEFAULT_EDGE, id: uid('edge'), selected: true, data: { label: '', protocol: '', mode: 'sync', tradeoff: emptyTradeoff() } };
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setEdges((es) => addEdge(edge, es.map((x) => ({ ...x, selected: false }))));
    },
    [setEdges, setNodes, snapshot],
  );

  // 작은 점이 아니라 블록 아무 곳에나 놓아도 연결되게 한다. React Flow는 핸들 근처에 놓을 때만 연결해 준다.
  const onConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const el = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node-arch');
      const target = el?.getAttribute('data-id');
      if (!target || target === state.fromNode.id) return;
      onConnect({ source: state.fromNode.id, sourceHandle: state.fromHandle?.id ?? null, target, targetHandle: null });
    },
    [onConnect],
  );

  // 그룹 상자를 끌면 소속 블록도 같은 거리만큼 옮긴다.
  const drag = useRef(null);
  const onNodeDragStart = useCallback(
    (_e, _node, dragged) => {
      snapshot();
      const zoneIds = new Set(dragged.filter((n) => n.type === 'zone').map((n) => n.id));
      const draggedIds = new Set(dragged.map((n) => n.id));
      if (!zoneIds.size) return (drag.current = null);
      const members = latest.current.nodes.filter((n) => n.type === 'arch' && zoneIds.has(n.data.group) && !draggedIds.has(n.id));
      drag.current = {
        zones: Object.fromEntries(dragged.filter((n) => n.type === 'zone').map((z) => [z.id, { ...z.position }])),
        members: Object.fromEntries(members.map((m) => [m.id, { group: m.data.group, ...m.position }])),
      };
    },
    [snapshot],
  );
  const followZones = useCallback(
    (dragged) => {
      if (!drag.current) return;
      const delta = {};
      for (const z of dragged) {
        const start = drag.current.zones[z.id];
        if (start) delta[z.id] = { x: z.position.x - start.x, y: z.position.y - start.y };
      }
      setNodes((ns) =>
        ns.map((n) => {
          const m = drag.current?.members[n.id];
          const d = m && delta[m.group];
          return d ? { ...n, position: { x: m.x + d.x, y: m.y + d.y } } : n;
        }),
      );
    },
    [setNodes],
  );
  const onNodeDrag = useCallback((_e, _node, dragged) => followZones(dragged), [followZones]);
  const onNodeDragStop = useCallback(
    (_e, _node, dragged) => {
      // 끌기 중간 이벤트를 놓쳐도 놓는 순간의 위치로 한 번 더 맞춘다.
      followZones(dragged);
      drag.current = null;
      const moved = dragged.filter((n) => n.type === 'arch');
      if (!moved.length) return;
      setNodes((ns) =>
        ns.map((n) => {
          if (!moved.some((m) => m.id === n.id)) return n;
          const group = zoneAt(ns, centerOf(n));
          return group === n.data.group ? n : { ...n, data: { ...n.data, group } };
        }),
      );
    },
    [followZones, setNodes],
  );

  const onBeforeDelete = useCallback(async () => {
    snapshot();
    return true;
  }, [snapshot]);
  const onNodesDelete = useCallback(
    (deleted) => {
      const zoneIds = new Set(deleted.filter((n) => n.type === 'zone').map((n) => n.id));
      if (zoneIds.size) setNodes((ns) => ns.map((n) => (n.type === 'arch' && zoneIds.has(n.data.group) ? { ...n, data: { ...n.data, group: '' } } : n)));
    },
    [setNodes],
  );

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const selNode = selectedNodes.length === 1 && !selectedEdges.length ? selectedNodes[0] : null;
  const selEdge = selectedEdges.length === 1 && !selectedNodes.length ? selectedEdges[0] : null;
  const zones = useMemo(() => nodes.filter((n) => n.type === 'zone'), [nodes]);
  const labelOf = (id) => nodes.find((n) => n.id === id)?.data.label || id;

  const patchNode = (id, patch) => {
    snapshot(true);
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };
  const patchEdge = (id, patch) => {
    snapshot(true);
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)));
  };
  const removeSelected = () => rf.deleteElements({ nodes: selectedNodes, edges: selectedEdges });

  const duplicate = useCallback(() => {
    const picked = latest.current.nodes.filter((n) => n.selected && n.type === 'arch');
    if (!picked.length) return;
    snapshot();
    const copies = picked.map((n) => ({ ...structuredClone({ data: n.data, position: n.position }), id: uid('node'), type: 'arch', zIndex: 10, selected: true }));
    copies.forEach((c) => {
      c.position = { x: c.position.x + 32, y: c.position.y + 32 };
      c.data.label = `${c.data.label} 복사본`;
    });
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copies]);
  }, [setNodes, snapshot]);

  const currentBoard = () => ({ ...board, nodes: serializeNodes(latest.current.nodes), edges: serializeEdges(latest.current.edges) });

  const aiTradeoff = async (target) => {
    setBusy((b) => ({ ...b, tradeoff: true }));
    try {
      const tradeoff = await api.tradeoff(currentBoard(), target);
      if (target.type === 'edge') patchEdge(target.id, { tradeoff });
      else patchNode(target.id, { tradeoff });
      notify('AI가 트레이드오프를 작성했습니다');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy((b) => ({ ...b, tradeoff: false }));
    }
  };

  const aiReview = async () => {
    setBusy((b) => ({ ...b, review: true }));
    try {
      onMetaChange({ review: await api.review(currentBoard()) });
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy((b) => ({ ...b, review: false }));
    }
  };

  const exportPng = async () => {
    const all = rf.getNodes();
    if (!all.length) return;
    const bounds = getNodesBounds(all);
    const width = Math.min(4200, Math.max(800, bounds.width * 1.6 + 160));
    const height = Math.min(4200, Math.max(500, bounds.height * 1.6 + 160));
    const vp = getViewportForBounds(bounds, width, height, 0.4, 2, 0.06);
    try {
      const url = await toPng(document.querySelector('.react-flow__viewport'), {
        backgroundColor: '#f8fafc',
        width,
        height,
        skipFonts: true,
        pixelRatio: 2,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'architecture'}.png`;
      a.click();
    } catch (err) {
      notify(`이미지 저장 실패: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, duplicate]);

  const blocks = nodes.filter((n) => n.type === 'arch');

  return (
    <div className="editor">
      <Palette onAdd={addCenter} />
      <div className="canvas" ref={wrapper} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          connectionRadius={36}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onBeforeDelete={onBeforeDelete}
          onNodesDelete={onNodesDelete}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={DEFAULT_EDGE}
          connectionLineStyle={{ stroke: '#4f46e5', strokeWidth: 2 }}
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode={['Meta', 'Shift']}
          elevateNodesOnSelect={false}
          snapToGrid
          snapGrid={[8, 8]}
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1.2} color="#cbd5e1" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === 'zone' ? '#e2e8f0' : kindOf(n.data.kind).color)} maskColor="rgba(241,245,249,0.7)" />
          <Panel position="top-center" className="toolbar">
            <button className="btn btn-sm" onClick={() => layout()} title="블록을 흐름에 맞게 자동 정렬">자동 정리</button>
            <div className="segmented small">
              {[
                ['LR', '가로'],
                ['TB', '세로'],
              ].map(([d, label]) => (
                <button
                  key={d}
                  className={direction === d ? 'is-on' : ''}
                  onClick={() => {
                    setDirection(d);
                    onMetaChange({ direction: d });
                    layout(d);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="toolbar-sep" />
            <button className="btn btn-sm btn-ghost" onClick={undo} title="실행 취소 (Cmd+Z)">되돌리기</button>
            <button className="btn btn-sm btn-ghost" onClick={redo} title="다시 실행 (Cmd+Shift+Z)">다시</button>
            <button className="btn btn-sm btn-ghost" onClick={fit}>화면 맞춤</button>
            <span className="toolbar-sep" />
            <button className="btn btn-sm btn-ghost" onClick={exportPng}>PNG 저장</button>
          </Panel>
          {!blocks.length && (
            <Panel position="top-center" className="empty">
              <div className="empty-card">
                <h3>빈 보드입니다</h3>
                <p>왼쪽 블록을 끌어다 놓고, 블록 테두리의 점을 끌어 다른 블록에 놓으면 화살표가 생깁니다.</p>
                {onImport && <button className="btn btn-ai" onClick={onImport}>내 코드 폴더에서 자동 생성</button>}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
      <aside className="inspector">
        {selNode?.type === 'arch' && (
          <NodeInspector
            node={selNode}
            zones={zones}
            onChange={(p) => patchNode(selNode.id, p)}
            onAi={() => aiTradeoff({ type: 'node', id: selNode.id })}
            aiBusy={busy.tradeoff}
            aiReady={aiReady}
            onDuplicate={duplicate}
            onDelete={removeSelected}
          />
        )}
        {selNode?.type === 'zone' && (
          <ZoneInspector
            node={selNode}
            memberCount={blocks.filter((b) => b.data.group === selNode.id).length}
            onChange={(p) => patchNode(selNode.id, p)}
            onDelete={removeSelected}
          />
        )}
        {selEdge && (
          <EdgeInspector
            edge={selEdge}
            sourceLabel={labelOf(selEdge.source)}
            targetLabel={labelOf(selEdge.target)}
            onChange={(p) => patchEdge(selEdge.id, p)}
            onReverse={() => {
              snapshot();
              setEdges((es) => es.map((e) => (e.id === selEdge.id ? { ...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle } : e)));
            }}
            onAi={() => aiTradeoff({ type: 'edge', id: selEdge.id })}
            aiBusy={busy.tradeoff}
            aiReady={aiReady}
            onDelete={removeSelected}
          />
        )}
        {!selNode && !selEdge && (
          <>
            {selectedNodes.length + selectedEdges.length > 1 && (
              <div className="multi">
                {selectedNodes.length + selectedEdges.length}개 선택됨
                <button className="btn btn-ghost btn-sm danger" onClick={removeSelected}>모두 삭제</button>
              </div>
            )}
            <BoardPanel board={board} nodes={nodes} edges={edges} onMetaChange={onMetaChange} onReview={aiReview} reviewBusy={busy.review} aiReady={aiReady} />
          </>
        )}
      </aside>
    </div>
  );
}

export default function Editor(props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
