import { ArrowLeft, Download, ImagePlus, Search, X } from 'lucide-react';
import {
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  SyntheticEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { resolveWorkImageSrc } from '../../utils/imageDisplay';
import type { PicFlowCase, PicFlowImage } from '../../types';
import type { CreativeTrace, ImageTraceNode, TextTraceNode, TraceEdge, WorkTraceNode } from './traceTypes';

type CanvasNode = TextTraceNode | ImageTraceNode | WorkTraceNode;

type TraceCanvasProps = {
  trace: CreativeTrace;
  works: PicFlowCase[];
  onBack: () => void;
  onRename: (title: string) => void;
  onCreateTextNode: (x: number, y: number) => string;
  onPasteTextNode: (source: Pick<TextTraceNode, 'text' | 'width'>, x: number, y: number) => string;
  onCreateImageNodes: (files: File[], x: number, y: number) => Promise<string[]>;
  onPasteImageNode: (file: File, x: number, y: number) => Promise<string | null>;
  onCreateWorkNode: (workId: string, x: number, y: number) => string;
  onUpdateTextNode: (nodeId: string, text: string, options?: { removeIfEmpty?: boolean }) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onMoveNodes: (positions: Array<{ id: string; x: number; y: number }>) => void;
  onResizeNode: (nodeId: string, width: number, height: number) => void;
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

type ResizeState = {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  padding: number;
  ratio: number;
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
const minImageNodeWidth = 120;
const maxImageNodeWidth = 600;
const compactWorkDefaultWidth = 280;
const compactWorkDefaultHeight = 200;
const imageNodePadding = 6;
const compactWorkNodePadding = 8;

export function TraceCanvas({
  trace,
  works,
  onBack,
  onRename,
  onCreateTextNode,
  onPasteTextNode,
  onCreateImageNodes,
  onPasteImageNode,
  onCreateWorkNode,
  onUpdateTextNode,
  onMoveNode,
  onMoveNodes,
  onResizeNode,
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
  const resizeRef = useRef<ResizeState | null>(null);
  const mediaAspectRatiosRef = useRef(new Map<string, number>());
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
  const [resizePreview, setResizePreview] = useState<Record<string, { width: number; height: number }> | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionState | null>(null);
  const [copiedNode, setCopiedNode] = useState<Pick<TextTraceNode, 'text' | 'width' | 'x' | 'y'> | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const [workSearch, setWorkSearch] = useState('');

  const canvasNodes = useMemo(
    () => trace.nodes.filter((node): node is CanvasNode => node.type === 'text' || node.type === 'image' || node.type === 'work'),
    [trace.nodes]
  );
  const workMap = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const filteredWorks = useMemo(() => {
    const query = workSearch.trim().toLowerCase();
    if (!query) return works;
    return works.filter((work) =>
      [
        work.title,
        work.prompt,
        work.optimizedPrompt,
        work.promptCn,
        work.promptEn,
        ...(work.modelTags ?? [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [workSearch, works]);
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
    setResizePreview(null);
    setSelectionBox(null);
    selectionRef.current = null;
    resizeRef.current = null;
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
          setResizePreview(null);
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

  function clampImageNodeWidth(value: number): number {
    return Math.min(maxImageNodeWidth, Math.max(minImageNodeWidth, value));
  }

  function compactWorkSize(node: WorkTraceNode): { width: number; height: number } {
    if (node.width === 440 && node.height === 380) {
      return { width: compactWorkDefaultWidth, height: compactWorkDefaultHeight };
    }
    return { width: node.width, height: node.height };
  }

  function innerAspectRatio(size: { width: number; height: number }, padding: number): number {
    return Math.max(1, size.height - padding * 2) / Math.max(1, size.width - padding * 2);
  }

  function fitNodeSizeToAspect(width: number, aspectRatio: number, padding: number): { width: number; height: number } {
    const nextWidth = clampImageNodeWidth(width);
    const innerWidth = Math.max(1, nextWidth - padding * 2);
    return {
      width: Math.round(nextWidth),
      height: Math.round(innerWidth * aspectRatio + padding * 2)
    };
  }

  function handleMediaLoad(nodeId: string, size: { width: number; height: number }, padding: number, event: SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    if (!image.naturalWidth || !image.naturalHeight) return;
    const aspectRatio = image.naturalHeight / image.naturalWidth;
    mediaAspectRatiosRef.current.set(nodeId, aspectRatio);
    const fitted = fitNodeSizeToAspect(size.width, aspectRatio, padding);
    if (Math.abs(fitted.height - size.height) <= 2 && Math.abs(fitted.width - size.width) <= 2) return;
    onResizeNode(nodeId, fitted.width, fitted.height);
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

  function viewportCenterPoint(): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 120 };
    return canvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? { x: 120, y: 120 };
  }

  function workCoverImage(work?: PicFlowCase): PicFlowImage | undefined {
    if (!work) return undefined;
    return work.images.find((image) => image.id === work.coverImageId) ?? work.images[0];
  }

  function workTitle(work?: PicFlowCase): string {
    return work?.title.trim() || '作品';
  }

  function workPromptSummary(work?: PicFlowCase): string {
    return (work?.prompt || work?.optimizedPrompt || work?.promptCn || work?.promptEn || '').trim();
  }

  function workReferenceImages(work?: PicFlowCase): PicFlowImage[] {
    return work?.referenceImages ?? [];
  }

  function workModelTags(work?: PicFlowCase): string[] {
    return (work?.modelTags ?? []).map((tag) => tag.trim()).filter(Boolean);
  }

  function displayNode<T extends CanvasNode>(node: T): T {
    const preview = dragPreview?.[node.id];
    const size = resizePreview?.[node.id];
    if (!preview && !size) return node;
    return {
      ...node,
      x: preview?.x ?? node.x,
      y: preview?.y ?? node.y,
      width: size?.width ?? node.width,
      ...('height' in node ? { height: size?.height ?? node.height } : {})
    };
  }

  function fallbackHeight(node: CanvasNode): number {
    if (node.type === 'work') return node.height;
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

  function clampTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return lines;
    const next = lines.slice(0, maxLines);
    let last = next[next.length - 1] ?? '';
    while (last.length > 0 && ctx.measureText(`${last}...`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    next[next.length - 1] = `${last || next[next.length - 1]}...`;
    return next;
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

  async function drawContainedImage(
    ctx: CanvasRenderingContext2D,
    src: string,
    frame: { x: number; y: number; width: number; height: number },
    radius = 6
  ): Promise<void> {
    const image = await loadExportImage(src);
    if (!image) return;
    const scale = Math.min(frame.width / image.width, frame.height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = frame.x + (frame.width - drawWidth) / 2;
    const drawY = frame.y + (frame.height - drawHeight) / 2;
    ctx.save();
    roundedRectPath(ctx, drawX, drawY, drawWidth, drawHeight, radius);
    ctx.clip();
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
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
        ctx.fillStyle = node.type === 'image' || node.type === 'work'
          ? dark ? 'rgba(48,48,48,0.96)' : 'rgba(252,252,251,0.96)'
          : dark ? '#333333' : '#fbfbfa';
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
        } else if (node.type === 'image') {
          const imageSrc = resolveWorkImageSrc({ id: node.id, localPath: node.imagePath, name: node.name, addedAt: node.createdAt }, libraryPath);
          await drawContainedImage(ctx, imageSrc, { x: box.x + 6, y: box.y + 6, width: box.width - 12, height: box.height - 12 });
        } else {
          const work = workMap.get(node.workId);
          const cover = workCoverImage(work);
          const coverSrc = resolveWorkImageSrc(cover, libraryPath);
          const references = workReferenceImages(work);
          const prompt = workPromptSummary(work);
          const tags = workModelTags(work);
          const isCompactWork = references.length === 0 && !prompt && tags.length === 0;
          if (isCompactWork) {
            if (coverSrc) {
              await drawContainedImage(ctx, coverSrc, { x: box.x + compactWorkNodePadding, y: box.y + compactWorkNodePadding, width: box.width - compactWorkNodePadding * 2, height: box.height - compactWorkNodePadding * 2 }, 6);
            } else {
              roundedRectPath(ctx, box.x + compactWorkNodePadding, box.y + compactWorkNodePadding, box.width - compactWorkNodePadding * 2, box.height - compactWorkNodePadding * 2, 6);
              ctx.fillStyle = dark ? '#3b3b3b' : '#eef1ed';
              ctx.fill();
            }
            ctx.restore();
            continue;
          }
          const coverHeight = 220;
          if (coverSrc) {
            await drawContainedImage(ctx, coverSrc, { x: box.x + 8, y: box.y + 8, width: box.width - 16, height: coverHeight }, 6);
          } else {
            roundedRectPath(ctx, box.x + 8, box.y + 8, box.width - 16, coverHeight, 6);
            ctx.fillStyle = dark ? '#3b3b3b' : '#eef1ed';
            ctx.fill();
          }
          let nextY = box.y + coverHeight + 18;
          if (references.length > 0) {
            const visibleRefs = references.slice(0, 3);
            for (const [index, image] of visibleRefs.entries()) {
              const refSrc = resolveWorkImageSrc(image, libraryPath);
              const x = box.x + 10 + index * 68;
              roundedRectPath(ctx, x, nextY, 60, 60, 6);
              ctx.fillStyle = dark ? '#3a3a3a' : '#eef1ed';
              ctx.fill();
              if (refSrc) await drawContainedImage(ctx, refSrc, { x: x + 1, y: nextY + 1, width: 58, height: 58 }, 5);
            }
            if (references.length > 3) {
              ctx.font = '600 13px sans-serif';
              ctx.fillStyle = dark ? '#d7d7d7' : '#44403c';
              ctx.textBaseline = 'middle';
              ctx.fillText(`+${references.length - 3}`, box.x + 10 + visibleRefs.length * 68 + 2, nextY + 30);
            }
            nextY += 72;
          }
          ctx.textBaseline = 'top';
          if (prompt) {
            ctx.font = '12px sans-serif';
            ctx.fillStyle = dark ? '#d0d0d0' : '#57534e';
            const lines = wrapText(ctx, prompt, box.width - 24);
            lines.forEach((line, index) => {
              ctx.fillText(line, box.x + 12, nextY + index * 18);
            });
            nextY += lines.length * 18 + 8;
          }
          if (tags.length > 0) {
            ctx.font = '600 11px sans-serif';
            ctx.fillStyle = dark ? '#bdbdbd' : '#78716c';
            ctx.fillText(tags.slice(0, 3).join(' / '), box.x + 12, nextY);
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

  function handleNodeResizePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    node: ImageTraceNode | WorkTraceNode,
    size: { width: number; height: number },
    padding: number
  ): void {
    if (spacePressed || isPanning) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const startWidth = Math.max(minImageNodeWidth, size.width);
    const startHeight = Math.max(1, size.height);
    const ratio = mediaAspectRatiosRef.current.get(node.id) ?? innerAspectRatio(size, padding);
    resizeRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startWidth,
      startHeight,
      padding,
      ratio,
      moved: false
    };
    selectNodes([node.id]);
    setResizePreview({ [node.id]: { width: startWidth, height: startHeight } });
  }

  function handleNodeResizePointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const delta = Math.max(point.x - resize.startX, (point.y - resize.startY) / Math.max(resize.ratio, 0.1));
    const { width, height } = fitNodeSizeToAspect(resize.startWidth + delta, resize.ratio, resize.padding);
    resize.moved = resize.moved || Math.abs(point.x - resize.startX) > 3 || Math.abs(point.y - resize.startY) > 3;
    setResizePreview({ [resize.nodeId]: { width, height } });
  }

  function handleNodeResizePointerUp(event: PointerEvent<HTMLButtonElement>): void {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = canvasPoint(event.clientX, event.clientY);
    resizeRef.current = null;
    setResizePreview(null);
    suppressNextNodeClickRef.current = true;
    if (!resize.moved || !point) return;
    const delta = Math.max(point.x - resize.startX, (point.y - resize.startY) / Math.max(resize.ratio, 0.1));
    const { width, height } = fitNodeSizeToAspect(resize.startWidth + delta, resize.ratio, resize.padding);
    onResizeNode(resize.nodeId, width, height);
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

  function insertWorkNode(workId: string): void {
    const point = lastCanvasPointRef.current ?? viewportCenterPoint();
    const nodeId = onCreateWorkNode(workId, snapToGrid(point.x - compactWorkDefaultWidth / 2), snapToGrid(point.y - compactWorkDefaultHeight / 2));
    selectNodes([nodeId]);
    setWorkPickerOpen(false);
    setWorkSearch('');
  }

  const displayedNodes = canvasNodes.map((node) => displayNode(node));
  const displayedNodeMap = new Map(displayedNodes.map((node) => [node.id, node]));

  return (
    <section className="relative flex h-full min-h-0 flex-col bg-[#e6eae5] dark:bg-[#252525]">
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
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="tool-button h-9 px-3" onClick={() => setWorkPickerOpen(true)}>
            <ImagePlus className="h-4 w-4" />
            插入作品
          </button>
          <button className="tool-button h-9 px-3" onClick={() => void handleExportPng()} disabled={exporting}>
            <Download className="h-4 w-4" />
            {exporting ? '导出中' : '导出'}
          </button>
        </div>
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
          const work = node.type === 'work' ? workMap.get(node.workId) : undefined;
          const workCover = workCoverImage(work);
          const workRefs = workReferenceImages(work);
          const workPrompt = workPromptSummary(work);
          const modelTags = workModelTags(work);
          const isCompactWork = node.type === 'work' && workRefs.length === 0 && !workPrompt && modelTags.length === 0;
          const compactSize = node.type === 'work' && isCompactWork ? compactWorkSize(display as WorkTraceNode) : null;
          const imageSize = node.type === 'image' ? { width: display.width, height: (display as ImageTraceNode).height } : null;
          const fixedSize = imageSize ?? compactSize;
          const imageSrc =
            node.type === 'image'
              ? resolveWorkImageSrc({ id: node.id, localPath: node.imagePath, name: node.name, addedAt: node.createdAt }, libraryPath)
              : node.type === 'work'
                ? resolveWorkImageSrc(workCover, libraryPath)
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
              } ${node.type === 'image' ? 'trace-image-node p-1.5' : ''} ${node.type === 'work' ? `trace-work-node overflow-visible p-2 ${isCompactWork ? 'is-compact' : ''}` : ''}`}
              style={{
                left: display.x,
                top: display.y,
                width: node.type === 'work' ? (isCompactWork ? compactSize?.width : Math.max(display.width, 440)) : display.width,
                height: fixedSize?.height
              }}
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
                  ) : node.type === 'image' ? (
                    <div className="trace-image-frame h-full">
                      <img
                        src={imageSrc}
                        alt={node.name ?? 'trace image'}
                        draggable={false}
                        onLoad={(event) => imageSize && handleMediaLoad(node.id, imageSize, imageNodePadding, event)}
                      />
                    </div>
                  ) : (
                    <div className="trace-work-card">
                      <div className={isCompactWork ? 'trace-work-compact-frame h-full' : 'trace-work-cover'}>
                        {imageSrc ? (
                          <img
                            src={imageSrc}
                            alt={workTitle(work)}
                            draggable={false}
                            onLoad={(event) => compactSize && handleMediaLoad(node.id, compactSize, compactWorkNodePadding, event)}
                          />
                        ) : (
                          <div className="trace-work-cover-empty">
                            <ImagePlus className="h-7 w-7" />
                          </div>
                        )}
                      </div>
                      {!isCompactWork && workRefs.length > 0 && (
                        <div className="trace-work-references">
                          {workRefs.slice(0, 3).map((image) => (
                            <div key={image.id} className="trace-work-reference-thumb">
                              <img src={resolveWorkImageSrc(image, libraryPath)} alt={image.name ?? 'reference image'} draggable={false} />
                            </div>
                          ))}
                          {workRefs.length > 3 && <span className="trace-work-reference-more">+{workRefs.length - 3}</span>}
                        </div>
                      )}
                      {!isCompactWork && (workPrompt || modelTags.length > 0) && (
                        <div className="mt-2 min-w-0">
                          {workPrompt && <div className="trace-work-prompt text-xs leading-[17px] text-stone-500 dark:text-neutral-400">{workPrompt}</div>}
                          {modelTags.length > 0 && <div className="mt-2 truncate text-[11px] font-medium leading-4 text-stone-500 dark:text-neutral-400">{modelTags.slice(0, 3).join(' / ')}</div>}
                        </div>
                      )}
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
                  {fixedSize && (node.type === 'image' || isCompactWork) && isSelected && !isEditing && (
                    <button
                      type="button"
                      className="trace-image-resize-handle"
                      aria-label="缩放节点"
                      title="缩放节点"
                      onPointerDown={(event) =>
                        handleNodeResizePointerDown(
                          event,
                          node as ImageTraceNode | WorkTraceNode,
                          fixedSize,
                          node.type === 'image' ? imageNodePadding : compactWorkNodePadding
                        )
                      }
                      onPointerMove={handleNodeResizePointerMove}
                      onPointerUp={handleNodeResizePointerUp}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                    />
                  )}
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

      {workPickerOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/18 px-6 py-8 dark:bg-black/32" role="dialog" aria-modal="true">
          <div className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-[14px] border border-black/10 bg-[#fbfcfa] shadow-[0_24px_80px_rgba(23,32,28,0.24)] dark:border-white/10 dark:bg-[#303030] dark:shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
            <div className="flex items-center justify-between border-b border-black/8 px-5 py-4 dark:border-white/10">
              <div>
                <h3 className="text-sm font-semibold text-stone-800 dark:text-neutral-100">插入作品</h3>
                <p className="mt-1 text-xs text-stone-500 dark:text-neutral-400">从当前资源库选择一个作品作为复迹节点</p>
              </div>
              <button className="tool-button h-8 px-2" onClick={() => setWorkPickerOpen(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-black/8 px-5 py-3 dark:border-white/10">
              <label className="flex h-9 items-center gap-2 rounded-[9px] border border-black/10 bg-white px-3 text-stone-500 dark:border-white/10 dark:bg-[#262626] dark:text-neutral-400">
                <Search className="h-4 w-4" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  value={workSearch}
                  onChange={(event) => setWorkSearch(event.target.value)}
                  placeholder="搜索作品名称、Prompt 或模型标签"
                  autoFocus
                />
              </label>
            </div>
            <div className="min-h-[300px] overflow-y-auto p-5">
              {filteredWorks.length === 0 ? (
                <div className="flex min-h-[260px] items-center justify-center text-center">
                  <div>
                    <p className="text-sm font-medium text-stone-500 dark:text-neutral-300">没有找到作品</p>
                    <p className="mt-1 text-xs text-stone-400 dark:text-neutral-500">换个关键词试试</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                  {filteredWorks.map((work) => {
                    const cover = workCoverImage(work);
                    const coverSrc = resolveWorkImageSrc(cover, libraryPath);
                    return (
                      <button
                        key={work.id}
                        className="group overflow-hidden rounded-[10px] border border-black/10 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-black/18 hover:shadow-[0_14px_30px_rgba(23,32,28,0.14)] dark:border-white/10 dark:bg-[#272727] dark:hover:border-white/20 dark:hover:shadow-[0_14px_30px_rgba(0,0,0,0.28)]"
                        onClick={() => insertWorkNode(work.id)}
                      >
                        <div className="aspect-[4/3] bg-[#eef1ed] dark:bg-[#3a3a3a]">
                          {coverSrc ? (
                            <img className="h-full w-full object-contain" src={coverSrc} alt={workTitle(work)} loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-stone-400 dark:text-neutral-500">
                              <ImagePlus className="h-7 w-7" />
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <div className="truncate text-xs font-semibold text-stone-800 dark:text-neutral-100">{workTitle(work)}</div>
                          <div className="mt-1 truncate text-[11px] text-stone-500 dark:text-neutral-400">{(work.modelTags ?? []).join(' / ') || '未标注模型'}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
