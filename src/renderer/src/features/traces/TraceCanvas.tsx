import { ArrowLeft, Download } from 'lucide-react';
import {
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { resolveWorkImageSrc } from '../../utils/imageDisplay';
import type { CreativeTrace, ImageTraceNode, TextTraceNode, TraceEdge } from './traceTypes';

type CanvasNode = TextTraceNode | ImageTraceNode;

type TraceCanvasProps = {
  trace: CreativeTrace;
  onBack: () => void;
  onRename: (title: string) => void;
  onCreateTextNode: (x: number, y: number) => string;
  onPasteTextNode: (source: Pick<TextTraceNode, 'text' | 'width'>, x: number, y: number) => string;
  onCreateImageNodes: (files: File[], x: number, y: number) => Promise<string[]>;
  onPasteImageNode: (file: File, x: number, y: number) => Promise<string | null>;
  onUpdateTextNode: (nodeId: string, text: string, options?: { removeIfEmpty?: boolean }) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onMoveNodes: (positions: Array<{ id: string; x: number; y: number }>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteNodes: (nodeIds: string[]) => void;
  onCreateEdge: (fromNodeId: string, toNodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onUndo: () => boolean;
  onRedo: () => boolean;
  onExportPng: (dataUrl: string, fileName: string) => Promise<boolean>;
  libraryPath?: string;
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
  group: Array<{ nodeId: string; startX: number; startY: number }>;
};

type ConnectionState = {
  fromNodeId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  targetNodeId: string | null;
};

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

type SelectionState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};

type NodeBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const gridSize = 24;
const pasteOffset = 32;
const minScale = 0.4;
const maxScale = 2;
const scaleStep = 0.08;
const exportPadding = 100;

export function TraceCanvas({
  trace,
  onBack,
  onRename,
  onCreateTextNode,
  onPasteTextNode,
  onCreateImageNodes,
  onPasteImageNode,
  onUpdateTextNode,
  onMoveNode,
  onMoveNodes,
  onDeleteNode,
  onDeleteNodes,
  onCreateEdge,
  onDeleteEdge,
  onUndo,
  onRedo,
  onExportPng,
  libraryPath
}: TraceCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const skipTitleBlurSaveRef = useRef(false);
  const skipNodeBlurSaveRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const selectionRef = useRef<SelectionState | null>(null);
  const suppressNextCanvasClickRef = useRef(false);
  const suppressNextNodeClickRef = useRef(false);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(trace.title);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState('');
  const [editingOriginalText, setEditingOriginalText] = useState('');
  const [newEditingNodeId, setNewEditingNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionState | null>(null);
  const [copiedNode, setCopiedNode] = useState<Pick<TextTraceNode, 'text' | 'width' | 'x' | 'y'> | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canvasNodes = useMemo(
    () => trace.nodes.filter((node): node is CanvasNode => node.type === 'text' || node.type === 'image'),
    [trace.nodes]
  );
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const nodeIds = useMemo(() => new Set(canvasNodes.map((node) => node.id)), [canvasNodes]);
  const validEdges = useMemo(
    () => trace.edges.filter((edge): edge is TraceEdge => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)),
    [nodeIds, trace.edges]
  );

  useEffect(() => {
    if (!isTitleEditing) setTitleDraft(trace.title);
  }, [isTitleEditing, trace.title]);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnection(null);
    setDragPreview(null);
    setSelectionBox(null);
    selectionRef.current = null;
  }, [trace.id]);

  useEffect(() => {
    if (!editingNodeId) return;
    const node = canvasNodes.find((item) => item.id === editingNodeId);
    if (!node || node.type !== 'text') {
      setEditingNodeId(null);
      setNodeDraft('');
      setEditingOriginalText('');
    }
  }, [canvasNodes, editingNodeId]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') || target?.closest('[contenteditable="true"]')) return;
      if (editingNodeId || isTitleEditing) return;

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && key === 'z') {
        event.preventDefault();
        const changed = event.shiftKey ? onRedo() : onUndo();
        if (changed) {
          setSelectedNodeId(null);
          setSelectedNodeIds([]);
          setSelectedEdgeId(null);
          setConnection(null);
          setDragPreview(null);
          setSelectionBox(null);
        }
        return;
      }

      if (commandKey && key === 'c') {
        if (!selectedNodeId) return;
        const node = canvasNodes.find((item) => item.id === selectedNodeId);
        if (!node || node.type !== 'text') return;
        event.preventDefault();
        setCopiedNode({ text: node.text, width: node.width, x: node.x, y: node.y });
        return;
      }

      if (event.key !== 'Delete') return;
      if (selectedNodeIds.length === 0 && !selectedNodeId && !selectedEdgeId) return;
      event.preventDefault();
      if (selectedNodeIds.length > 1) {
        onDeleteNodes(selectedNodeIds);
        clearNodeSelection();
        setSelectedEdgeId(null);
        return;
      }
      if (selectedNodeId) {
        onDeleteNode(selectedNodeId);
        clearNodeSelection();
        setSelectedEdgeId(null);
        return;
      }
      if (selectedEdgeId) {
        onDeleteEdge(selectedEdgeId);
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasNodes, editingNodeId, isTitleEditing, onDeleteEdge, onDeleteNode, onDeleteNodes, onRedo, onUndo, selectedEdgeId, selectedNodeId, selectedNodeIds]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') || target?.closest('[contenteditable="true"]')) return;
      if (editingNodeId || isTitleEditing) return;
      if (event.code !== 'Space') return;
      event.preventDefault();
      setSpacePressed(true);
    };
    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpacePressed(false);
      if (panRef.current) {
        panRef.current = null;
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [editingNodeId, isTitleEditing]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') || target?.closest('[contenteditable="true"]')) return;
      if (editingNodeId || isTitleEditing) return;
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      const point = pastePoint();
      if (imageFile) {
        event.preventDefault();
        void onPasteImageNode(imageFile, point.x, point.y).then((nodeId) => {
          if (nodeId) {
            selectNodes([nodeId]);
            setSelectedEdgeId(null);
          }
        });
        return;
      }
      if (!copiedNode) return;
      event.preventDefault();
      const x = snapToGrid(copiedNode.x + pasteOffset);
      const y = snapToGrid(copiedNode.y + pasteOffset);
      const nodeId = onPasteTextNode(copiedNode, x, y);
      selectNodes([nodeId]);
      setSelectedEdgeId(null);
      setCopiedNode({ ...copiedNode, x, y });
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [copiedNode, editingNodeId, isTitleEditing, onPasteImageNode, onPasteTextNode]);

  function snapToGrid(value: number): number {
    return Math.round(value / gridSize) * gridSize;
  }

  function clampScale(value: number): number {
    return Math.min(maxScale, Math.max(minScale, value));
  }

  function selectNodes(nodeIds: string[]): void {
    setSelectedNodeIds(nodeIds);
    setSelectedNodeId(nodeIds.length === 1 ? nodeIds[0] : null);
    setSelectedEdgeId(null);
  }

  function clearNodeSelection(): void {
    setSelectedNodeIds([]);
    setSelectedNodeId(null);
  }

  function selectionRect(selection: SelectionState): NodeBox {
    const x = Math.min(selection.startX, selection.currentX);
    const y = Math.min(selection.startY, selection.currentY);
    return {
      x,
      y,
      width: Math.abs(selection.currentX - selection.startX),
      height: Math.abs(selection.currentY - selection.startY)
    };
  }

  function boxesIntersect(a: NodeBox, b: NodeBox): boolean {
    return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
  }

  function screenPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function canvasPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const point = screenPoint(clientX, clientY);
    if (!point) return null;
    return {
      x: (point.x - viewport.offsetX) / viewport.scale,
      y: (point.y - viewport.offsetY) / viewport.scale
    };
  }

  function pastePoint(): { x: number; y: number } {
    if (lastCanvasPointRef.current) return lastCanvasPointRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 120 };
    return { x: Math.max(24, rect.width / 2 - 130), y: Math.max(24, rect.height / 2 - 90) };
  }

  function displayNode<T extends CanvasNode>(node: T): T {
    const preview = dragPreview?.[node.id];
    if (!preview) return node;
    return { ...node, x: preview.x, y: preview.y };
  }

  function fallbackHeight(node: CanvasNode): number {
    return node.type === 'image' ? node.height : 96;
  }

  function nodeBox(node: CanvasNode): NodeBox {
    const display = displayNode(node);
    const element = nodeRefs.current.get(node.id);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (element && canvasRect) {
      const rect = element.getBoundingClientRect();
      return {
        x: display.x,
        y: display.y,
        width: rect.width ? rect.width / viewport.scale : display.width,
        height: rect.height ? rect.height / viewport.scale : fallbackHeight(display)
      };
    }
    return { x: display.x, y: display.y, width: display.width, height: fallbackHeight(display) };
  }

  function anchorBetween(fromNode: CanvasNode, toNode: CanvasNode): { from: { x: number; y: number }; to: { x: number; y: number } } {
    const from = nodeBox(fromNode);
    const to = nodeBox(toNode);
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) {
        return {
          from: { x: from.x + from.width, y: fromCenter.y },
          to: { x: to.x, y: toCenter.y }
        };
      }
      return {
        from: { x: from.x, y: fromCenter.y },
        to: { x: to.x + to.width, y: toCenter.y }
      };
    }

    if (dy >= 0) {
      return {
        from: { x: fromCenter.x, y: from.y + from.height },
        to: { x: toCenter.x, y: to.y }
      };
    }
    return {
      from: { x: fromCenter.x, y: from.y },
      to: { x: toCenter.x, y: to.y + to.height }
    };
  }

  function connectorAnchor(node: CanvasNode): { x: number; y: number } {
    const box = nodeBox(node);
    return { x: box.x + box.width, y: box.y + box.height / 2 };
  }

  function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const delta = Math.max(48, Math.abs(to.x - from.x) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x + delta} ${from.y}, ${to.x - delta} ${to.y}, ${to.x} ${to.y}`;
  }

  function drawEdgePath(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }): void {
    const delta = Math.max(48, Math.abs(to.x - from.x) * 0.45);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(from.x + delta, from.y, to.x - delta, to.y, to.x, to.y);
    ctx.stroke();
  }

  function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const size = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + size, y);
    ctx.lineTo(x + width - size, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + size);
    ctx.lineTo(x + width, y + height - size);
    ctx.quadraticCurveTo(x + width, y + height, x + width - size, y + height);
    ctx.lineTo(x + size, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - size);
    ctx.lineTo(x, y + size);
    ctx.quadraticCurveTo(x, y, x + size, y);
    ctx.closePath();
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of (text || '新节点').split('\n')) {
      let line = '';
      for (const char of paragraph) {
        const nextLine = `${line}${char}`;
        if (line && ctx.measureText(nextLine).width > maxWidth) {
          lines.push(line);
          line = char;
        } else {
          line = nextLine;
        }
      }
      lines.push(line || ' ');
    }
    return lines;
  }

  async function loadExportImage(src: string): Promise<HTMLImageElement | null> {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        };
        image.src = objectUrl;
      });
    } catch {
      return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
      });
    }
  }

  function sanitizeFileName(value: string): string {
    return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  }

  async function handleExportPng(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    try {
      const dark = document.documentElement.classList.contains('dark');
      const boxes = canvasNodes.map((node) => ({ node, box: nodeBox(node) }));
      const bounds = boxes.length
        ? boxes.reduce(
            (next, item) => ({
              minX: Math.min(next.minX, item.box.x),
              minY: Math.min(next.minY, item.box.y),
              maxX: Math.max(next.maxX, item.box.x + item.box.width),
              maxY: Math.max(next.maxY, item.box.y + item.box.height)
            }),
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
          )
        : { minX: -500, minY: -340, maxX: 500, maxY: 340 };
      const originX = bounds.minX - exportPadding;
      const originY = bounds.minY - exportPadding;
      const width = Math.max(320, Math.ceil(bounds.maxX - bounds.minX + exportPadding * 2));
      const height = Math.max(240, Math.ceil(bounds.maxY - bounds.minY + exportPadding * 2));
      const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.scale(ratio, ratio);
      ctx.translate(-originX, -originY);

      ctx.fillStyle = dark ? '#272727' : '#edf0ec';
      ctx.fillRect(originX, originY, width, height);
      ctx.fillStyle = dark ? 'rgba(214,214,214,0.18)' : 'rgba(100,105,98,0.24)';
      const gridStartX = Math.floor(originX / gridSize) * gridSize;
      const gridStartY = Math.floor(originY / gridSize) * gridSize;
      for (let x = gridStartX; x <= originX + width; x += gridSize) {
        for (let y = gridStartY; y <= originY + height; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const nodeMap = new Map(boxes.map((item) => [item.node.id, item.node]));
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)';
      validEdges.forEach((edge) => {
        const fromNode = nodeMap.get(edge.fromNodeId);
        const toNode = nodeMap.get(edge.toNodeId);
        if (!fromNode || !toNode) return;
        const anchors = anchorBetween(fromNode, toNode);
        drawEdgePath(ctx, anchors.from, anchors.to);
      });

      for (const { node, box } of boxes) {
        ctx.save();
        ctx.shadowColor = dark ? 'rgba(0,0,0,0.22)' : 'rgba(23,32,28,0.08)';
        ctx.shadowBlur = 22;
        ctx.shadowOffsetY = 10;
        roundedRectPath(ctx, box.x, box.y, box.width, box.height, 8);
        ctx.fillStyle = node.type === 'image' ? (dark ? 'rgba(48,48,48,0.96)' : 'rgba(252,252,251,0.96)') : dark ? '#333333' : '#fbfbfa';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = dark ? '#505050' : '#d3d8d1';
        ctx.lineWidth = 1;
        ctx.stroke();

        if (node.type === 'text') {
          ctx.font = '14px sans-serif';
          ctx.fillStyle = dark ? '#f5f5f5' : '#292524';
          ctx.textBaseline = 'top';
          const lineHeight = 24;
          const lines = wrapText(ctx, node.text || '新节点', box.width - 24);
          lines.forEach((line, index) => {
            ctx.fillText(line, box.x + 12, box.y + 12 + index * lineHeight);
          });
        } else {
          const imageSrc = resolveWorkImageSrc({ id: node.id, localPath: node.imagePath, name: node.name, addedAt: node.createdAt }, libraryPath);
          const image = await loadExportImage(imageSrc);
          if (image) {
            const frame = { x: box.x + 6, y: box.y + 6, width: box.width - 12, height: box.height - 12 };
            const scale = Math.min(frame.width / image.width, frame.height / image.height);
            const drawWidth = image.width * scale;
            const drawHeight = image.height * scale;
            const drawX = frame.x + (frame.width - drawWidth) / 2;
            const drawY = frame.y + (frame.height - drawHeight) / 2;
            roundedRectPath(ctx, drawX, drawY, drawWidth, drawHeight, 6);
            ctx.clip();
            ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
          }
        }
        ctx.restore();
      }

      const fileBase = sanitizeFileName(trace.title);
      const fileName = fileBase ? `tracenest-trace-${fileBase}.png` : 'tracenest-trace.png';
      const ok = await onExportPng(canvas.toDataURL('image/png'), fileName);
      if (!ok) throw new Error('Export canceled');
    } catch {
      await onExportPng('', '');
    } finally {
      setExporting(false);
    }
  }

  function targetNodeFromPoint(clientX: number, clientY: number, fromNodeId: string): string | null {
    const target = document
      .elementsFromPoint(clientX, clientY)
      .map((element) => (element as HTMLElement).closest?.('[data-trace-node-id]') as HTMLElement | null)
      .find((element): element is HTMLElement => Boolean(element?.dataset.traceNodeId && element.dataset.traceNodeId !== fromNodeId));
    return target?.dataset.traceNodeId ?? null;
  }

  function startTitleEditing(): void {
    skipTitleBlurSaveRef.current = false;
    setTitleDraft(trace.title);
    setIsTitleEditing(true);
  }

  function saveTitle(): void {
    if (skipTitleBlurSaveRef.current) {
      skipTitleBlurSaveRef.current = false;
      return;
    }
    if (!isTitleEditing) return;
    const title = titleDraft.trim();
    setIsTitleEditing(false);
    if (!title || title === trace.title) {
      setTitleDraft(trace.title);
      return;
    }
    onRename(title);
  }

  function cancelTitleEditing(): void {
    skipTitleBlurSaveRef.current = true;
    setTitleDraft(trace.title);
    setIsTitleEditing(false);
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTitle();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTitleEditing();
    }
  }

  function startNodeEditing(node: TextTraceNode, isNew = false): void {
    skipNodeBlurSaveRef.current = false;
    selectNodes([node.id]);
    setEditingNodeId(node.id);
    setNodeDraft(node.text);
    setEditingOriginalText(node.text);
    setNewEditingNodeId(isNew ? node.id : null);
  }

  function saveNodeEditing(): void {
    if (skipNodeBlurSaveRef.current) {
      skipNodeBlurSaveRef.current = false;
      return;
    }
    if (!editingNodeId) return;
    const text = nodeDraft.trim();
    const shouldRemove = newEditingNodeId === editingNodeId && !text;
    if (shouldRemove) {
      onUpdateTextNode(editingNodeId, '', { removeIfEmpty: true });
    } else if (text) {
      onUpdateTextNode(editingNodeId, text);
    } else {
      setNodeDraft(editingOriginalText);
    }
    setEditingNodeId(null);
    setEditingOriginalText('');
    setNewEditingNodeId(null);
  }

  function cancelNodeEditing(): void {
    if (!editingNodeId) return;
    skipNodeBlurSaveRef.current = true;
    if (newEditingNodeId === editingNodeId && !editingOriginalText.trim()) {
      onUpdateTextNode(editingNodeId, '', { removeIfEmpty: true });
    }
    setNodeDraft(editingOriginalText);
    setEditingNodeId(null);
    setEditingOriginalText('');
    setNewEditingNodeId(null);
  }

  function handleNodeKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      saveNodeEditing();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelNodeEditing();
    }
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const pan = panRef.current;
    if (pan) {
      event.preventDefault();
      const offsetX = pan.offsetX + event.clientX - pan.startX;
      const offsetY = pan.offsetY + event.clientY - pan.startY;
      pan.moved = pan.moved || Math.abs(event.clientX - pan.startX) > 3 || Math.abs(event.clientY - pan.startY) > 3;
      setViewport((current) => ({ ...current, offsetX, offsetY }));
      return;
    }
    const selection = selectionRef.current;
    if (selection && selection.pointerId === event.pointerId) {
      const point = canvasPoint(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      selection.currentX = point.x;
      selection.currentY = point.y;
      selection.moved =
        selection.moved ||
        Math.abs(selection.currentX - selection.startX) > 4 ||
        Math.abs(selection.currentY - selection.startY) > 4;
      setSelectionBox({ ...selection });
      lastCanvasPointRef.current = point;
      return;
    }
    lastCanvasPointRef.current = canvasPoint(event.clientX, event.clientY);
  }

  function handleCanvasPointerDownCapture(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    if (spacePressed) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: viewport.offsetX,
        offsetY: viewport.offsetY,
        moved: false
      };
      setIsPanning(true);
      clearNodeSelection();
      setSelectedEdgeId(null);
      return;
    }
    if (editingNodeId || isTitleEditing || connection || target?.closest('[data-trace-node="true"]')) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectionRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      moved: false
    };
    setSelectionBox({ ...selectionRef.current });
    setSelectedEdgeId(null);
  }

  function handleCanvasPointerUp(event: PointerEvent<HTMLDivElement>): void {
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (pan.moved) suppressNextCanvasClickRef.current = true;
      panRef.current = null;
      setIsPanning(false);
      return;
    }

    const selection = selectionRef.current;
    if (!selection || selection.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    selectionRef.current = null;
    setSelectionBox(null);
    if (!selection.moved) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextCanvasClickRef.current = true;
    const rect = selectionRect(selection);
    const selectedIds = canvasNodes.filter((node) => boxesIntersect(rect, nodeBox(node))).map((node) => node.id);
    selectNodes(selectedIds);
  }

  function handleCanvasDoubleClick(event: MouseEvent<HTMLDivElement>): void {
    if (spacePressed || isPanning) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('[data-trace-node="true"]')) return;
    if (target.closest('button, input, textarea, select')) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const width = 240;
    const x = point.x - width / 2;
    const y = point.y - 28;
    const nodeId = onCreateTextNode(x, y);
    selectNodes([nodeId]);
    setEditingNodeId(nodeId);
    setNodeDraft('');
    setEditingOriginalText('');
    setNewEditingNodeId(nodeId);
  }

  function handleCanvasClick(event: MouseEvent<HTMLDivElement>): void {
    if (suppressNextCanvasClickRef.current) {
      suppressNextCanvasClickRef.current = false;
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('[data-trace-node="true"]')) return;
    if (target.closest('button, input, textarea, select')) return;
    clearNodeSelection();
    setSelectedEdgeId(null);
  }

  function handleCanvasDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleCanvasDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const x = point.x - 130;
    const y = point.y - 90;
    void onCreateImageNodes(Array.from(event.dataTransfer.files ?? []), x, y).then((ids) => {
      const lastId = ids[ids.length - 1];
      if (lastId) {
        selectNodes([lastId]);
        setSelectedEdgeId(null);
      }
    });
  }

  function handleNodePointerDown(event: PointerEvent<HTMLDivElement>, node: CanvasNode): void {
    if (spacePressed || isPanning) return;
    if (editingNodeId === node.id) return;
    if ((event.target as HTMLElement | null)?.closest('textarea, input, button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const display = displayNode(node);
    const shouldDragGroup = selectedNodeIdSet.has(node.id) && selectedNodeIds.length > 1;
    const groupNodes = shouldDragGroup
      ? canvasNodes.filter((item) => selectedNodeIdSet.has(item.id)).map((item) => displayNode(item))
      : [display];
    dragRef.current = {
      nodeId: node.id,
      offsetX: point.x - display.x,
      offsetY: point.y - display.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      group: groupNodes.map((item) => ({ nodeId: item.id, startX: item.x, startY: item.y }))
    };
    if (!shouldDragGroup) selectNodes([node.id]);
    else setSelectedEdgeId(null);
    setDragPreview(Object.fromEntries(groupNodes.map((item) => [item.id, { x: item.x, y: item.y }])));
  }

  function handleNodePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const x = snapToGrid(point.x - drag.offsetX);
    const y = snapToGrid(point.y - drag.offsetY);
    drag.moved = drag.moved || Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;
    const primary = drag.group.find((item) => item.nodeId === drag.nodeId);
    const deltaX = primary ? x - primary.startX : 0;
    const deltaY = primary ? y - primary.startY : 0;
    setDragPreview(
      Object.fromEntries(
        drag.group.map((item) => [item.nodeId, { x: item.startX + deltaX, y: item.startY + deltaY }])
      )
    );
  }

  function handleNodePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = canvasPoint(event.clientX, event.clientY);
    dragRef.current = null;
    setDragPreview(null);
    if (!drag.moved || !point) return;
    suppressNextNodeClickRef.current = true;
    const x = snapToGrid(point.x - drag.offsetX);
    const y = snapToGrid(point.y - drag.offsetY);
    const primary = drag.group.find((item) => item.nodeId === drag.nodeId);
    const deltaX = primary ? x - primary.startX : 0;
    const deltaY = primary ? y - primary.startY : 0;
    const positions = drag.group.map((item) => ({ id: item.nodeId, x: item.startX + deltaX, y: item.startY + deltaY }));
    if (positions.length > 1) onMoveNodes(positions);
    else onMoveNode(drag.nodeId, x, y);
  }

  function handleConnectorPointerDown(event: PointerEvent<HTMLButtonElement>, node: CanvasNode): void {
    if (spacePressed || isPanning) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const anchor = connectorAnchor(node);
    selectNodes([node.id]);
    setConnection({
      fromNodeId: node.id,
      startX: anchor.x,
      startY: anchor.y,
      currentX: point.x,
      currentY: point.y,
      targetNodeId: null
    });
  }

  function handleConnectorPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    if (!connection) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const targetNodeId = targetNodeFromPoint(event.clientX, event.clientY, connection.fromNodeId);
    const fromNode = canvasNodes.find((node) => node.id === connection.fromNodeId);
    const targetNode = targetNodeId ? canvasNodes.find((node) => node.id === targetNodeId) : null;
    const targetAnchor = fromNode && targetNode ? anchorBetween(fromNode, targetNode).to : null;
    setConnection((current) =>
      current
        ? {
            ...current,
            currentX: targetAnchor?.x ?? point.x,
            currentY: targetAnchor?.y ?? point.y,
            targetNodeId
          }
        : current
    );
  }

  function handleConnectorPointerUp(event: PointerEvent<HTMLButtonElement>): void {
    if (!connection) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const targetNodeId = connection.targetNodeId ?? targetNodeFromPoint(event.clientX, event.clientY, connection.fromNodeId);
    if (targetNodeId && targetNodeId !== connection.fromNodeId) onCreateEdge(connection.fromNodeId, targetNodeId);
    setConnection(null);
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const point = screenPoint(event.clientX, event.clientY);
    if (!point) return;
    setViewport((current) => {
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextScale = clampScale(Number((current.scale + direction * scaleStep).toFixed(2)));
      if (nextScale === current.scale) return current;
      const logicalX = (point.x - current.offsetX) / current.scale;
      const logicalY = (point.y - current.offsetY) / current.scale;
      return {
        scale: nextScale,
        offsetX: point.x - logicalX * nextScale,
        offsetY: point.y - logicalY * nextScale
      };
    });
  }

  const displayedNodes = canvasNodes.map((node) => displayNode(node));
  const displayedNodeMap = new Map(displayedNodes.map((node) => [node.id, node]));

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#e6eae5] dark:bg-[#252525]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#d8ddd7]/80 bg-[#f7f8f5]/82 px-6 backdrop-blur dark:border-[#3b3b3b] dark:bg-[#2d2d2d]/88">
        <div className="flex min-w-0 items-center gap-3">
          <button className="tool-button h-9 px-2.5" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <div className="min-w-0">
            {isTitleEditing ? (
              <input
                className="field-input h-8 w-[260px] max-w-full px-2 py-1 text-sm font-semibold"
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={handleTitleKeyDown}
              />
            ) : (
              <button className="max-w-full text-left" onDoubleClick={startTitleEditing} title="双击重命名">
                <h2 className="truncate text-sm font-semibold text-stone-800 dark:text-neutral-100">{trace.title}</h2>
              </button>
            )}
            <p className="mt-0.5 text-xs text-stone-500 dark:text-neutral-500">{canvasNodes.length} 个节点</p>
          </div>
        </div>
        <button className="tool-button h-9 px-3" onClick={() => void handleExportPng()} disabled={exporting}>
          <Download className="h-4 w-4" />
          {exporting ? '导出中' : '导出 PNG'}
        </button>
      </header>

      <div
        ref={canvasRef}
        className={`trace-canvas-grid relative min-h-0 flex-1 overflow-hidden ${isPanning ? 'cursor-grabbing' : spacePressed ? 'cursor-grab' : ''}`}
        style={{
          backgroundSize: `${gridSize * viewport.scale}px ${gridSize * viewport.scale}px`,
          backgroundPosition: `${viewport.offsetX}px ${viewport.offsetY}px`
        }}
        onPointerMove={handleCanvasPointerMove}
        onPointerDownCapture={handleCanvasPointerDownCapture}
        onPointerUp={handleCanvasPointerUp}
        onWheel={handleCanvasWheel}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        <div
          className="absolute left-0 top-0 z-0"
          style={{
            width: `${100 / viewport.scale}%`,
            height: `${100 / viewport.scale}%`,
            transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
            transformOrigin: '0 0'
          }}
        >
        <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible">
          {validEdges.map((edge) => {
            const fromNode = displayedNodeMap.get(edge.fromNodeId);
            const toNode = displayedNodeMap.get(edge.toNodeId);
            if (!fromNode || !toNode) return null;
            const anchors = anchorBetween(fromNode, toNode);
            const path = edgePath(anchors.from, anchors.to);
            const selected = selectedEdgeId === edge.id;
            return (
              <g key={edge.id} className="pointer-events-auto">
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    clearNodeSelection();
                  }}
                />
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth={selected ? 2.5 : 2}
                  className={selected ? 'text-stone-500/60 dark:text-neutral-200/50' : 'text-stone-700/20 dark:text-neutral-100/25'}
                />
              </g>
            );
          })}
          {connection && (
            <path
              d={edgePath({ x: connection.startX, y: connection.startY }, { x: connection.currentX, y: connection.currentY })}
              fill="none"
              stroke="currentColor"
              strokeDasharray="5 5"
              strokeLinecap="round"
              strokeWidth="2"
              className="text-stone-700/28 dark:text-neutral-100/32"
            />
          )}
        </svg>

        {canvasNodes.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 w-[320px] -translate-x-1/2 -translate-y-1/2 text-center">
            <p className="text-sm font-medium text-stone-500 dark:text-neutral-300">双击空白处新建文字节点</p>
            <p className="mt-2 text-xs leading-5 text-stone-400 dark:text-neutral-500">之后可拖拽图片进来，整理你的创作路径</p>
          </div>
        )}

        {selectionBox?.moved && (
          <div
            className="pointer-events-none absolute z-30 rounded-[6px] border border-[rgba(0,0,0,0.24)] bg-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.34)] dark:bg-[rgba(255,255,255,0.10)]"
            style={{
              left: selectionRect(selectionBox).x,
              top: selectionRect(selectionBox).y,
              width: selectionRect(selectionBox).width,
              height: selectionRect(selectionBox).height
            }}
          />
        )}

        {canvasNodes.map((node) => {
          const display = displayNode(node);
          const isEditing = editingNodeId === node.id && node.type === 'text';
          const isSelected = selectedNodeIdSet.has(node.id) || isEditing;
          const imageSrc =
            node.type === 'image'
              ? resolveWorkImageSrc({ id: node.id, localPath: node.imagePath, name: node.name, addedAt: node.createdAt }, libraryPath)
              : '';
          return (
            <div
              key={node.id}
              ref={(element) => {
                if (element) nodeRefs.current.set(node.id, element);
                else nodeRefs.current.delete(node.id);
              }}
              data-trace-node="true"
              data-trace-node-id={node.id}
              className={`group absolute z-10 select-none rounded-[8px] border bg-[#fbfbfa] p-3 text-sm leading-6 transition-colors dark:bg-[#333] ${
                connection?.targetNodeId === node.id
                  ? 'border-[rgba(0,0,0,0.34)] shadow-[0_18px_36px_rgba(23,32,28,0.15)] ring-2 ring-[rgba(0,0,0,0.10)] dark:border-[rgba(255,255,255,0.48)] dark:shadow-[0_18px_36px_rgba(0,0,0,0.3)] dark:ring-2 dark:ring-[rgba(255,255,255,0.10)]'
                  : isSelected
                    ? 'border-[rgba(0,0,0,0.28)] shadow-[0_16px_34px_rgba(23,32,28,0.14)] ring-1 ring-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.38)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.28)] dark:ring-1 dark:ring-[rgba(255,255,255,0.08)]'
                    : 'border-[#d3d8d1] shadow-[0_12px_28px_rgba(23,32,28,0.08)] dark:border-[#505050] dark:shadow-[0_12px_28px_rgba(0,0,0,0.22)]'
              } ${node.type === 'image' ? 'trace-image-node p-1.5' : ''}`}
              style={{ left: display.x, top: display.y, width: display.width }}
              onPointerDown={(event) => handleNodePointerDown(event, node)}
              onPointerMove={handleNodePointerMove}
              onPointerUp={handleNodePointerUp}
              onClick={(event) => {
                event.stopPropagation();
                if (suppressNextNodeClickRef.current) {
                  suppressNextNodeClickRef.current = false;
                  return;
                }
                selectNodes([node.id]);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (node.type === 'text') startNodeEditing(node);
              }}
            >
              {node.type === 'text' && isEditing ? (
                <textarea
                  className="min-h-[72px] w-full resize-none border-0 bg-transparent text-sm leading-6 text-stone-800 outline-none placeholder:text-stone-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  autoFocus
                  value={nodeDraft}
                  placeholder="输入内容"
                  onChange={(event) => setNodeDraft(event.target.value)}
                  onBlur={saveNodeEditing}
                  onKeyDown={handleNodeKeyDown}
                />
              ) : (
                <>
                  {node.type === 'text' ? (
                    <div className="whitespace-pre-wrap break-words text-stone-800 dark:text-neutral-100">
                      {node.text || '新节点'}
                    </div>
                  ) : (
                    <div className="trace-image-frame">
                      <img src={imageSrc} alt={node.name ?? 'trace image'} draggable={false} />
                    </div>
                  )}
                  <button
                    type="button"
                    className={`absolute -right-3 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(0,0,0,0.18)] bg-[#f4f4f4] text-stone-600 shadow-[0_6px_16px_rgba(23,32,28,0.12)] transition hover:bg-white dark:border-[rgba(255,255,255,0.22)] dark:bg-[#dedede] dark:text-[#222] dark:shadow-[0_6px_16px_rgba(0,0,0,0.22)] ${
                      isSelected || connection?.fromNodeId === node.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    aria-label="创建连接"
                    title="创建连接"
                    onPointerDown={(event) => handleConnectorPointerDown(event, node)}
                    onPointerMove={handleConnectorPointerMove}
                    onPointerUp={handleConnectorPointerUp}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          );
        })}
        </div>
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-black/10 bg-white/72 px-2.5 py-1 text-xs font-medium text-stone-500 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#2f2f2f]/78 dark:text-neutral-300">
          {Math.round(viewport.scale * 100)}%
        </div>
      </div>
    </section>
  );
}
