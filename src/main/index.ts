import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

type PicFlowCaptureMethod = 'manual' | 'local-import' | 'drag-drop' | 'clipboard-paste' | 'url-paste';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'picflow-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

type PicFlowImage = {
  id: string;
  url?: string;
  localPath?: string;
  name?: string;
  type?: 'cover' | 'reference' | 'source' | 'result' | 'screenshot';
  addedAt: string;
};

type PicFlowCase = {
  id: string;
  title: string;
  status: 'pending' | 'confirmed';
  images: PicFlowImage[];
  referenceImages?: PicFlowImage[];
  coverImageId?: string;
  favorite: boolean;
  hidden: boolean;
  collectionId?: string;
  modelTags?: string[];
  sourceUrl?: string;
  sourceNote?: string;
  captureMethod?: PicFlowCaptureMethod;
  capturedAt?: string;
  createdAt: string;
  updatedAt: string;
  keywordText?: string;
  prompt?: string;
  optimizedPrompt?: string;
  promptCn?: string;
  promptEn?: string;
  note?: string;
};

type PicFlowCollection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type PicFlowData = {
  version: 1;
  cases: PicFlowCase[];
  collections: PicFlowCollection[];
  settings?: {
    theme?: 'light' | 'dark';
    cardScale?: number;
  };
};

type PicFlowBaseTraceNode = {
  id: string;
  type: 'center' | 'text' | 'image';
  x: number;
  y: number;
  width: number;
};

type PicFlowCenterTraceNode = PicFlowBaseTraceNode & {
  type: 'center';
  height: number;
  title: string;
};

type PicFlowTextTraceNode = PicFlowBaseTraceNode & {
  type: 'text';
  height?: number;
  text: string;
  createdAt: string;
  updatedAt: string;
};

type PicFlowImageTraceNode = PicFlowBaseTraceNode & {
  type: 'image';
  height: number;
  imagePath: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

type PicFlowTraceNode = PicFlowCenterTraceNode | PicFlowTextTraceNode | PicFlowImageTraceNode;

type PicFlowTraceImageAsset = {
  imagePath: string;
  name?: string;
};

type PicFlowTraceEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  createdAt: string;
};

type PicFlowTrace = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: PicFlowTraceNode[];
  edges: PicFlowTraceEdge[];
};

type PicFlowTraceData = {
  traces: PicFlowTrace[];
};

type PicFlowLibraryActionResult = {
  ok: boolean;
  message: string;
  state?: PicFlowLibraryState;
  backupPath?: string;
};

type PicFlowLibraryManifest = {
  name: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
};

type PicFlowLibrarySummary = {
  name: string;
  path: string;
  lastOpenedAt: string;
};

type PicFlowAppConfig = {
  currentLibraryPath?: string;
  recentLibraries: PicFlowLibrarySummary[];
};

type PicFlowLibraryState = {
  ready: boolean;
  setupRequired: boolean;
  missing: boolean;
  currentLibrary?: PicFlowLibrarySummary;
  recentLibraries: PicFlowLibrarySummary[];
};

type PicFlowLibraryLoadDebug = {
  currentLibraryPath: string;
  worksPath: string;
  collectionsPath: string;
  settingsPath: string;
  worksCount: number;
  collectionsCount: number;
};

type PicFlowLibraryLoadResult = {
  ok: boolean;
  message?: string;
  state: PicFlowLibraryState;
  data?: PicFlowData;
  debug?: PicFlowLibraryLoadDebug;
};

const defaultSettings = (): NonNullable<PicFlowData['settings']> => ({
  theme: 'light',
  cardScale: 1.12
});
const emptyData = (): PicFlowData => ({ version: 1, cases: [], collections: [], settings: defaultSettings() });
const emptyConfig = (): PicFlowAppConfig => ({ recentLibraries: [] });
let mainWindow: BrowserWindow | null = null;

function dataDir(): string {
  const localRoot = process.env.LOCALAPPDATA || app.getPath('userData');
  return join(localRoot, 'PicFlow', 'App', 'local-data');
}

function legacyImageDir(): string {
  return join(dataDir(), 'images');
}

function legacyDataPath(): string {
  return join(dataDir(), 'aigc-flow-library-data.json');
}

function appConfigPath(): string {
  return join(app.getPath('userData'), 'picflow-global-settings.json');
}

function defaultLibraryPath(): string {
  return join(app.getPath('userData'), 'PicFlow Library');
}

function timestampForPath(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function runtimeBackupRoot(): string {
  return join(dirname(app.getPath('userData')), `PicFlow-backup-${timestampForPath()}`);
}

function manifestPath(root: string): string {
  return join(root, 'picflow-library.json');
}

function worksPath(root: string): string {
  return join(root, 'data', 'works.json');
}

function collectionsPath(root: string): string {
  return join(root, 'data', 'collections.json');
}

function settingsPath(root: string): string {
  return join(root, 'data', 'settings.json');
}

function tracesPath(root: string): string {
  return join(root, 'data', 'traces.json');
}

function assetsDir(root: string): string {
  return join(root, 'assets');
}

function referencesDir(root: string): string {
  return join(root, 'references');
}

function traceAssetsDir(root: string): string {
  return join(root, 'traces', 'assets');
}

function currentLibraryPathOrThrow(): string {
  const libraryPath = getCurrentLibraryPath();
  if (!libraryPath) throw new Error('No active PicFlow library');
  ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath));
  return libraryPath;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function readAppConfig(): PicFlowAppConfig {
  const config = readJson<PicFlowAppConfig>(appConfigPath(), emptyConfig());
  const seen = new Set<string>();
  const recentLibraries = (Array.isArray(config.recentLibraries) ? config.recentLibraries : []).filter((item) => {
    if (!item.path || seen.has(item.path)) return false;
    if (!existsSync(item.path) || !existsSync(manifestPath(item.path))) return false;
    seen.add(item.path);
    return true;
  });
  const currentLibraryPath = validLibraryPath(config.currentLibraryPath)
    ? config.currentLibraryPath
    : validLibraryPath(defaultLibraryPath())
      ? defaultLibraryPath()
      : undefined;
  return {
    currentLibraryPath,
    recentLibraries
  };
}

function writeAppConfig(config: PicFlowAppConfig): PicFlowAppConfig {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(appConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

function validLibraryPath(root?: string): root is string {
  return Boolean(root && existsSync(root) && existsSync(manifestPath(root)));
}

function readManifest(root: string): PicFlowLibraryManifest | null {
  if (!validLibraryPath(root)) return null;
  const manifest = readJson<PicFlowLibraryManifest | null>(manifestPath(root), null);
  if (!manifest || manifest.version !== 1 || !manifest.name) return null;
  return manifest;
}

function libraryNameFromPath(root: string, fallback = 'PicFlow Library'): string {
  return basename(root) || fallback;
}

function normalizeData(data: Partial<PicFlowData>): PicFlowData {
  return {
    version: 1,
    cases: Array.isArray(data.cases) ? data.cases : [],
    collections: Array.isArray(data.collections) ? data.collections : [],
    settings: { ...defaultSettings(), ...data.settings }
  };
}

function normalizeTraceData(data: Partial<PicFlowTraceData>): PicFlowTraceData {
  return {
    traces: Array.isArray(data.traces)
      ? data.traces.map((trace) => ({
          ...trace,
          nodes: Array.isArray(trace.nodes) ? trace.nodes : [],
          edges: Array.isArray(trace.edges) ? trace.edges : []
        }))
      : []
  };
}

function isExternalImagePath(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('data:');
}

function normalizeLibraryLocalPath(libraryPath: string, value?: string): string | undefined {
  if (!value || isExternalImagePath(value) || isAbsolute(value)) return value;
  return normalize(join(libraryPath, value));
}

function normalizeLibraryImage(libraryPath: string, image: PicFlowImage): PicFlowImage {
  return {
    ...image,
    localPath: normalizeLibraryLocalPath(libraryPath, image.localPath)
  };
}

function normalizeLibraryDataForRead(libraryPath: string, data: PicFlowData): PicFlowData {
  return {
    ...data,
    cases: data.cases.map((item) => ({
      ...item,
      images: (item.images ?? []).map((image) => normalizeLibraryImage(libraryPath, image)),
      referenceImages: (item.referenceImages ?? []).map((image) => normalizeLibraryImage(libraryPath, image))
    }))
  };
}

function readLegacyData(): PicFlowData {
  return normalizeData(readJson<PicFlowData>(legacyDataPath(), emptyData()));
}

function hasLegacyData(): boolean {
  if (!existsSync(legacyDataPath())) return false;
  const data = readLegacyData();
  return data.cases.length > 0 || data.collections.length > 0 || existsSync(legacyImageDir());
}

function ensureLibraryStructure(root: string, name = libraryNameFromPath(root), seed?: PicFlowData): PicFlowLibrarySummary {
  const timestamp = new Date().toISOString();
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(assetsDir(root), { recursive: true });
  mkdirSync(referencesDir(root), { recursive: true });
  mkdirSync(traceAssetsDir(root), { recursive: true });
  mkdirSync(join(root, 'thumbnails'), { recursive: true });

  if (!existsSync(manifestPath(root))) {
    const manifest: PicFlowLibraryManifest = {
      name,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    writeJson(manifestPath(root), manifest);
  }

  if (!existsSync(worksPath(root))) writeJson(worksPath(root), seed?.cases ?? []);
  if (!existsSync(collectionsPath(root))) writeJson(collectionsPath(root), seed?.collections ?? []);
  if (!existsSync(settingsPath(root))) writeJson(settingsPath(root), { ...defaultSettings(), ...seed?.settings });
  if (!existsSync(tracesPath(root))) writeJson(tracesPath(root), { traces: [] });

  const manifest = readManifest(root);
  return {
    name: manifest?.name ?? name,
    path: root,
    lastOpenedAt: timestamp
  };
}

function updateRecentLibrary(summary: PicFlowLibrarySummary): PicFlowAppConfig {
  const config = readAppConfig();
  const nextSummary = { ...summary, lastOpenedAt: new Date().toISOString() };
  const recentLibraries = [
    nextSummary,
    ...config.recentLibraries.filter((item) => item.path !== summary.path)
  ].slice(0, 8);
  return writeAppConfig({ currentLibraryPath: summary.path, recentLibraries });
}

function ensureLegacyLibraryIfNeeded(): PicFlowLibrarySummary | null {
  const config = readAppConfig();
  if (config.currentLibraryPath) return null;
  if (!hasLegacyData()) return null;
  const summary = ensureLibraryStructure(dataDir(), '默认资源库', readLegacyData());
  updateRecentLibrary(summary);
  return summary;
}

function getCurrentLibraryPath(): string | null {
  const config = readAppConfig();
  if (validLibraryPath(config.currentLibraryPath)) return config.currentLibraryPath;
  const legacy = ensureLegacyLibraryIfNeeded();
  if (legacy) return legacy.path;
  if (!config.currentLibraryPath) {
    const summary = ensureLibraryStructure(defaultLibraryPath(), '\u9ed8\u8ba4\u8d44\u6e90\u5e93');
    updateRecentLibrary(summary);
    return summary.path;
  }
  return null;
}

function getLibraryState(): PicFlowLibraryState {
  const config = readAppConfig();
  const currentPath = getCurrentLibraryPath();
  if (currentPath) {
    const manifest = readManifest(currentPath);
    const currentLibrary = {
      name: manifest?.name ?? libraryNameFromPath(currentPath),
      path: currentPath,
      lastOpenedAt: new Date().toISOString()
    };
    return {
      ready: true,
      setupRequired: false,
      missing: false,
      currentLibrary,
      recentLibraries: readAppConfig().recentLibraries
    };
  }
  return {
    ready: false,
    setupRequired: !config.currentLibraryPath,
    missing: Boolean(config.currentLibraryPath),
    recentLibraries: config.recentLibraries
  };
}

function readDataFromLibrary(libraryPath: string): PicFlowData {
  ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath));
  return normalizeLibraryDataForRead(libraryPath, {
    version: 1,
    cases: readJson<PicFlowCase[]>(worksPath(libraryPath), []),
    collections: readJson<PicFlowCollection[]>(collectionsPath(libraryPath), []),
    settings: { ...defaultSettings(), ...readJson<PicFlowData['settings']>(settingsPath(libraryPath), defaultSettings()) }
  });
}

function readData(): PicFlowData {
  const libraryPath = getCurrentLibraryPath();
  if (!libraryPath) return emptyData();
  return readDataFromLibrary(libraryPath);
}

function loadCurrentLibraryData(): PicFlowLibraryLoadResult {
  const state = getLibraryState();
  const libraryPath = state.currentLibrary?.path ?? getCurrentLibraryPath();
  if (!state.ready || !libraryPath) {
    return {
      ok: false,
      message: '未找到当前资源库',
      state
    };
  }

  try {
    const data = readDataFromLibrary(libraryPath);
    return {
      ok: true,
      state: getLibraryState(),
      data,
      debug: {
        currentLibraryPath: libraryPath,
        worksPath: worksPath(libraryPath),
        collectionsPath: collectionsPath(libraryPath),
        settingsPath: settingsPath(libraryPath),
        worksCount: data.cases.length,
        collectionsCount: data.collections.length
      }
    };
  } catch {
    return {
      ok: false,
      message: '资源库数据读取失败',
      state
    };
  }
}

function writeData(data: PicFlowData): PicFlowData {
  const normalized: PicFlowData = {
    version: 1,
    cases: Array.isArray(data.cases) ? data.cases : [],
    collections: Array.isArray(data.collections) ? data.collections : [],
    settings: { ...defaultSettings(), ...data.settings }
  };
  const libraryPath = getCurrentLibraryPath();
  if (!libraryPath) return normalized;
  ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath));
  writeJson(worksPath(libraryPath), normalized.cases);
  writeJson(collectionsPath(libraryPath), normalized.collections);
  writeJson(settingsPath(libraryPath), normalized.settings ?? defaultSettings());
  return normalized;
}

function readTraceData(): PicFlowTraceData {
  const libraryPath = currentLibraryPathOrThrow();
  ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath));
  const data = normalizeTraceData(readJson<PicFlowTraceData>(tracesPath(libraryPath), { traces: [] }));
  if (!existsSync(tracesPath(libraryPath))) writeJson(tracesPath(libraryPath), data);
  return data;
}

function writeTraceData(data: PicFlowTraceData): PicFlowTraceData {
  const libraryPath = currentLibraryPathOrThrow();
  ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath));
  const normalized = normalizeTraceData(data);
  writeJson(tracesPath(libraryPath), normalized);
  return normalized;
}

function relativeTraceAssetPath(fileName: string): string {
  return normalize(join('traces', 'assets', fileName));
}

function saveTraceImagePath(filePath: string): PicFlowTraceImageAsset {
  const libraryPath = currentLibraryPathOrThrow();
  updateRecentLibrary(ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath)));
  const extension = extname(filePath) || '.png';
  const id = randomUUID();
  const fileName = `${id}${extension}`;
  const targetPath = join(traceAssetsDir(libraryPath), fileName);
  copyFileSync(filePath, targetPath);
  return {
    imagePath: relativeTraceAssetPath(fileName),
    name: basename(filePath)
  };
}

function saveTraceImagePaths(filePaths: string[]): PicFlowTraceImageAsset[] {
  return filePaths.map((filePath) => saveTraceImagePath(filePath));
}

function saveTraceDataUrlImage(dataUrl: string, name = 'trace-image.png'): PicFlowTraceImageAsset {
  const libraryPath = currentLibraryPathOrThrow();
  updateRecentLibrary(ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath)));
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('Unsupported image data');
  const extension = extensionFromMime(match[1]);
  const id = randomUUID();
  const fileName = `${id}${extension}`;
  const targetPath = join(traceAssetsDir(libraryPath), fileName);
  writeFileSync(targetPath, Buffer.from(match[2], 'base64'));
  return {
    imagePath: relativeTraceAssetPath(fileName),
    name
  };
}

function copyImageToLibrary(filePath: string, target: 'asset' | 'reference' = 'asset'): PicFlowImage {
  const libraryPath = currentLibraryPathOrThrow();
  updateRecentLibrary(ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath)));
  const extension = extname(filePath) || '.png';
  const id = randomUUID();
  const targetPath = join(target === 'reference' ? referencesDir(libraryPath) : assetsDir(libraryPath), `${id}${extension}`);
  copyFileSync(filePath, targetPath);
  return {
    id,
    localPath: targetPath,
    name: basename(filePath),
    type: target === 'reference' ? 'reference' : 'cover',
    addedAt: new Date().toISOString()
  };
}

function saveDataUrlImage(dataUrl: string, name = 'clipboard-image.png', target: 'asset' | 'reference' = 'asset'): PicFlowImage {
  const libraryPath = currentLibraryPathOrThrow();
  updateRecentLibrary(ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath)));
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('Unsupported image data');
  const mime = match[1];
  const extension = mime.includes('jpeg') ? '.jpg' : `.${mime.split('/')[1] || 'png'}`;
  const id = randomUUID();
  const targetPath = join(target === 'reference' ? referencesDir(libraryPath) : assetsDir(libraryPath), `${id}${extension}`);
  writeFileSync(targetPath, Buffer.from(match[2], 'base64'));
  return {
    id,
    localPath: targetPath,
    name,
    type: target === 'reference' ? 'reference' : 'screenshot',
    addedAt: new Date().toISOString()
  };
}

function extensionFromMime(mime: string, fallback = '.png'): string {
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('bmp')) return '.bmp';
  if (mime.includes('avif')) return '.avif';
  return fallback;
}

async function saveUrlImage(url: string): Promise<PicFlowImage> {
  const libraryPath = currentLibraryPathOrThrow();
  updateRecentLibrary(ensureLibraryStructure(libraryPath, libraryNameFromPath(libraryPath)));
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
  const mime = response.headers.get('content-type') ?? '';
  if (!mime.startsWith('image/')) throw new Error('Unsupported image URL');
  const urlPath = new URL(url).pathname;
  const fallbackExtension = extname(urlPath) || extensionFromMime(mime);
  const extension = fallbackExtension.startsWith('.') ? fallbackExtension : `.${fallbackExtension}`;
  const id = randomUUID();
  const targetPath = join(assetsDir(libraryPath), `${id}${extension}`);
  writeFileSync(targetPath, Buffer.from(await response.arrayBuffer()));
  return {
    id,
    localPath: targetPath,
    name: basename(urlPath) || `image-${id}${extension}`,
    type: 'cover',
    addedAt: new Date().toISOString()
  };
}

function copyImageToClipboard(image: PicFlowImage): boolean {
  let nextImage = nativeImage.createEmpty();
  if (image.localPath) {
    nextImage = nativeImage.createFromPath(image.localPath);
  } else if (image.url?.startsWith('data:image/')) {
    nextImage = nativeImage.createFromDataURL(image.url);
  }

  if (nextImage.isEmpty()) return false;
  clipboard.writeImage(nextImage);
  return true;
}

function imageFromDataUrl(dataUrl: string): Electron.NativeImage {
  if (!dataUrl.startsWith('data:image/png;base64,')) return nativeImage.createEmpty();
  return nativeImage.createFromDataURL(dataUrl);
}

function copyShareCardPngToClipboard(dataUrl: string): boolean {
  const image = imageFromDataUrl(dataUrl);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  return true;
}

function readClipboardImage(): { dataUrl: string; width: number; height: number } | null {
  let image = clipboard.readImage();
  if (image.isEmpty()) {
    const filePath = readClipboardImageFilePath();
    if (filePath) image = nativeImage.createFromPath(filePath);
  }
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (!size.width || !size.height) return null;
  return {
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height
  };
}

function readClipboardImageFilePath(): string | null {
  try {
    const buffer = clipboard.readBuffer('FileNameW');
    if (!buffer.length) return null;
    const value = buffer.toString('utf16le').replace(/\0+$/, '');
    if (!value || !existsSync(value)) return null;
    if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

async function exportShareCardPng(dataUrl: string, defaultName = 'tracenest-share-card.png'): Promise<boolean> {
  const image = imageFromDataUrl(dataUrl);
  if (image.isEmpty()) return false;

  const result = await dialog.showSaveDialog({
    title: '导出分享卡',
    defaultPath: defaultName,
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return false;

  writeFileSync(result.filePath, image.toPNG());
  return true;
}

function setCurrentLibrary(root: string): PicFlowLibrarySummary {
  const summary = ensureLibraryStructure(root, libraryNameFromPath(root));
  updateRecentLibrary(summary);
  return summary;
}

function setupDefaultLibrary(): PicFlowLibraryActionResult {
  const summary = ensureLibraryStructure(defaultLibraryPath(), '默认资源库');
  updateRecentLibrary(summary);
  return { ok: true, message: '已创建默认资源库', state: getLibraryState() };
}

async function chooseCustomLibrary(): Promise<PicFlowLibraryActionResult> {
  const result = await dialog.showOpenDialog({
    title: '选择 TraceNest 资源库存放位置',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, message: '请先设置资源库后再开始使用 TraceNest', state: getLibraryState() };
  const summary = ensureLibraryStructure(result.filePaths[0], libraryNameFromPath(result.filePaths[0]));
  updateRecentLibrary(summary);
  return { ok: true, message: '已创建资源库', state: getLibraryState() };
}

async function createLibraryShell(): Promise<PicFlowLibraryActionResult> {
  const result = await dialog.showOpenDialog({
    title: '创建新 TraceNest 资源库',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, message: '已取消创建资源库', state: getLibraryState() };

  try {
    if (existsSync(manifestPath(result.filePaths[0]))) return { ok: false, message: '该文件夹已经是 TraceNest 资源库', state: getLibraryState() };
    const summary = ensureLibraryStructure(result.filePaths[0], libraryNameFromPath(result.filePaths[0]));
    updateRecentLibrary(summary);
    return { ok: true, message: '已创建并切换资源库', state: getLibraryState() };
  } catch {
    return { ok: false, message: '资源库创建失败', state: getLibraryState() };
  }
}

async function addLibraryShell(): Promise<PicFlowLibraryActionResult> {
  const result = await dialog.showOpenDialog({
    title: '添加 TraceNest 资源库',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, message: '已取消添加资源库', state: getLibraryState() };

  const manifest = readManifest(result.filePaths[0]);
  if (!manifest) return { ok: false, message: '这不是有效的 TraceNest 资源库', state: getLibraryState() };
  const summary = ensureLibraryStructure(result.filePaths[0], manifest.name);
  updateRecentLibrary(summary);
  return { ok: true, message: '已切换资源库', state: getLibraryState() };
}

function switchLibrary(root: string): PicFlowLibraryActionResult {
  const manifest = readManifest(root);
  if (!manifest) return { ok: false, message: '资源库不存在或无效', state: getLibraryState() };
  updateRecentLibrary({ name: manifest.name, path: root, lastOpenedAt: new Date().toISOString() });
  return { ok: true, message: '已切换资源库', state: getLibraryState() };
}

async function openLibraryLocation(): Promise<PicFlowLibraryActionResult> {
  const libraryPath = getCurrentLibraryPath();
  if (!libraryPath) return { ok: false, message: '暂未找到资源库位置', state: getLibraryState() };
  const error = await shell.openPath(libraryPath);
  if (error) return { ok: false, message: '暂未找到资源库位置', state: getLibraryState() };
  return { ok: true, message: '已打开资源库位置', state: getLibraryState() };
}

function backupAndResetTestData(): PicFlowLibraryActionResult {
  const backupRoot = runtimeBackupRoot();
  try {
    mkdirSync(backupRoot, { recursive: true });
    const userDataPath = app.getPath('userData');
    if (existsSync(userDataPath)) {
      cpSync(userDataPath, join(backupRoot, 'userData'), { recursive: true, force: true });
    }
    if (existsSync(dataDir())) {
      cpSync(dataDir(), join(backupRoot, 'legacy-local-data'), { recursive: true, force: true });
    }
  } catch {
    return { ok: false, message: '测试数据备份失败，已取消重置' };
  }

  try {
    const userDataPath = app.getPath('userData');
    const pathsToRemove = [
      appConfigPath(),
      defaultLibraryPath(),
      join(userDataPath, 'Local Storage'),
      join(userDataPath, 'Session Storage'),
      join(userDataPath, 'IndexedDB'),
      dataDir()
    ];

    for (const targetPath of pathsToRemove) {
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
    }

    return { ok: true, message: '测试数据已重置，请重启应用', backupPath: backupRoot, state: getLibraryState() };
  } catch {
    return { ok: false, message: '测试数据重置失败', backupPath: backupRoot, state: getLibraryState() };
  }
}

function registerImageProtocol(): void {
  protocol.handle('picflow-file', (request) => {
    try {
      const url = new URL(request.url);
      const filePath = url.searchParams.get('path');
      if (!filePath || !existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Invalid image path', { status: 400 });
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: '图迹 TraceNest',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('focus', () => {
    mainWindow?.webContents.send('picflow-window:focus');
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerImageProtocol();

  ipcMain.handle('picflow:load-data', () => readData());
  ipcMain.handle('picflow:save-data', (_event, data: PicFlowData) => writeData(data));
  ipcMain.handle('picflow:load-traces', () => readTraceData());
  ipcMain.handle('picflow:save-traces', (_event, data: PicFlowTraceData) => writeTraceData(data));
  ipcMain.handle('picflow:save-trace-image-paths', (_event, filePaths: string[]) => saveTraceImagePaths(filePaths));
  ipcMain.handle('picflow:save-trace-data-url-image', (_event, dataUrl: string, name?: string) => saveTraceDataUrlImage(dataUrl, name));
  ipcMain.handle('picflow:get-storage-info', () => {
    const libraryPath = getCurrentLibraryPath();
    return {
      dataPath: libraryPath ? worksPath(libraryPath) : '',
      imageDir: libraryPath ? assetsDir(libraryPath) : ''
    };
  });
  ipcMain.handle('picflow:select-images', async (_event, target: 'asset' | 'reference' = 'asset') => {
    const result = await dialog.showOpenDialog({
      title: '导入图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }]
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => copyImageToLibrary(filePath, target));
  });
  ipcMain.handle('picflow:import-image-paths', (_event, filePaths: string[], target: 'asset' | 'reference' = 'asset') => filePaths.map((filePath) => copyImageToLibrary(filePath, target)));
  ipcMain.handle('picflow:save-data-url-image', (_event, dataUrl: string, name?: string, target: 'asset' | 'reference' = 'asset') => saveDataUrlImage(dataUrl, name, target));
  ipcMain.handle('picflow:save-url-image', (_event, url: string) => saveUrlImage(url));
  ipcMain.handle('picflow:copy-image', (_event, image: PicFlowImage) => copyImageToClipboard(image));
  ipcMain.handle('picflow:export-share-card-png', (_event, dataUrl: string, defaultName?: string) => exportShareCardPng(dataUrl, defaultName));
  ipcMain.handle('picflow:copy-share-card-png', (_event, dataUrl: string) => copyShareCardPngToClipboard(dataUrl));
  ipcMain.handle('picflow-clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('picflow-clipboard:read-image', () => readClipboardImage());
  ipcMain.handle('picflow:open-external', (_event, url: string) => {
    if (url) shell.openExternal(url);
  });
  ipcMain.handle('library:get-current', () => getLibraryState());
  ipcMain.handle('library:load-current-data', () => loadCurrentLibraryData());
  ipcMain.handle('library:setup-default', () => setupDefaultLibrary());
  ipcMain.handle('library:choose-custom', () => chooseCustomLibrary());
  ipcMain.handle('library:create', () => createLibraryShell());
  ipcMain.handle('library:add', () => addLibraryShell());
  ipcMain.handle('library:open-location', () => openLibraryLocation());
  ipcMain.handle('library:switch', (_event, root: string) => switchLibrary(root));
  ipcMain.handle('library:reset-test-data', () => backupAndResetTestData());
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
