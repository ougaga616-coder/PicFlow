export type TraceNodeType = 'center' | 'text' | 'image' | 'work';

export type BaseTraceNode = {
  id: string;
  type: TraceNodeType;
  x: number;
  y: number;
  width: number;
};

export type CenterTraceNode = BaseTraceNode & {
  type: 'center';
  height: number;
  title: string;
};

export type TextTraceNode = BaseTraceNode & {
  type: 'text';
  height?: number;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type ImageTraceNode = BaseTraceNode & {
  type: 'image';
  height: number;
  imagePath: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkTraceNode = BaseTraceNode & {
  type: 'work';
  height: number;
  workId: string;
  createdAt: string;
  updatedAt: string;
};

export type TraceNode = CenterTraceNode | TextTraceNode | ImageTraceNode | WorkTraceNode;

export type TraceEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  createdAt: string;
};

export type CreativeTrace = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
};

export type TraceData = {
  traces: CreativeTrace[];
};

export const emptyTraceData: TraceData = { traces: [] };

export function createCenterNode(title: string): TraceNode {
  return {
    id: crypto.randomUUID(),
    type: 'center',
    x: 0,
    y: 0,
    width: 220,
    height: 96,
    title
  };
}

export function createTextNode(x: number, y: number, text = '', width = 240): TextTraceNode {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x,
    y,
    width,
    text,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createImageNode(x: number, y: number, imagePath: string, name?: string): ImageTraceNode {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'image',
    x,
    y,
    width: 260,
    height: 180,
    imagePath,
    name,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createWorkNode(x: number, y: number, workId: string): WorkTraceNode {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'work',
    x,
    y,
    width: 280,
    height: 200,
    workId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function nextDefaultTraceTitle(traces: CreativeTrace[]): string {
  const baseTitle = '未命名复迹';
  const existingTitles = new Set(traces.map((trace) => trace.title.trim()));
  if (!existingTitles.has(baseTitle)) return baseTitle;

  let index = 2;
  while (existingTitles.has(`${baseTitle} ${index}`)) index += 1;
  return `${baseTitle} ${index}`;
}

export function createTrace(title = '未命名复迹'): CreativeTrace {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: []
  };
}

export function normalizeTraceTitle(value: string): string {
  return value.trim() || '未命名复迹';
}

export function renameTrace(trace: CreativeTrace, titleValue: string): CreativeTrace {
  const title = normalizeTraceTitle(titleValue);
  return {
    ...trace,
    title,
    updatedAt: new Date().toISOString()
  };
}

export function updateTraceTextNode(trace: CreativeTrace, nodeId: string, text: string): CreativeTrace {
  const timestamp = new Date().toISOString();
  return {
    ...trace,
    updatedAt: timestamp,
    nodes: trace.nodes.map((node) =>
      node.id === nodeId && node.type === 'text'
        ? { ...node, text, updatedAt: timestamp }
        : node
    )
  };
}

export function moveTraceNode(trace: CreativeTrace, nodeId: string, x: number, y: number): CreativeTrace {
  const timestamp = new Date().toISOString();
  return {
    ...trace,
    updatedAt: timestamp,
    nodes: trace.nodes.map((node) =>
      node.id === nodeId
        ? node.type === 'text' || node.type === 'image' || node.type === 'work'
          ? { ...node, x, y, updatedAt: timestamp }
          : { ...node, x, y }
        : node
    )
  };
}

export function deleteTraceNode(trace: CreativeTrace, nodeId: string): CreativeTrace {
  const timestamp = new Date().toISOString();
  return {
    ...trace,
    updatedAt: timestamp,
    nodes: trace.nodes.filter((node) => node.id !== nodeId),
    edges: trace.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId)
  };
}

export function createTraceEdge(trace: CreativeTrace, fromNodeId: string, toNodeId: string): CreativeTrace {
  if (fromNodeId === toNodeId) return trace;
  const exists = trace.edges.some(
    (edge) =>
      (edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId) ||
      (edge.fromNodeId === toNodeId && edge.toNodeId === fromNodeId)
  );
  if (exists) return trace;
  const timestamp = new Date().toISOString();
  return {
    ...trace,
    updatedAt: timestamp,
    edges: [
      ...trace.edges,
      {
        id: crypto.randomUUID(),
        fromNodeId,
        toNodeId,
        createdAt: timestamp
      }
    ]
  };
}

export function deleteTraceEdge(trace: CreativeTrace, edgeId: string): CreativeTrace {
  const timestamp = new Date().toISOString();
  return {
    ...trace,
    updatedAt: timestamp,
    edges: trace.edges.filter((edge) => edge.id !== edgeId)
  };
}
