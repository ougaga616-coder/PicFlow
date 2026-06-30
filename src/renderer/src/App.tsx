import {
  Check,
  ChevronDown,
  Copy,
  Folder,
  Heart,
  ImagePlus,
  Inbox,
  Link,
  Database,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { ClipboardEvent as ReactClipboardEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AppTitlebar } from './components/AppTitlebar';
import { ClipboardPromptConfirm } from './components/ClipboardPromptConfirm';
import { PostImportInfoModal, type PostImportInfoPayload } from './components/PostImportInfoModal';
import { ShareCardModal } from './components/ShareCardModal';
import { Toast } from './components/Toast';
import { useSmartClipboard } from './hooks/useSmartClipboard';
import type { PicFlowCase, PicFlowClipboardApi, PicFlowCollection, PicFlowData, PicFlowImage, PicFlowLibraryApi, PicFlowLibraryState } from './types';
import { resolveWorkImageSrc } from './utils/imageDisplay';
import { buildWorkSummaryText, copyTextToClipboard, formatModelTagsForCopy } from './utils/workCopy';
import { filterWorksByQuery } from './utils/workSearch';
import { updateWork } from './utils/workUpdates';

type ViewKey = 'all' | 'pending' | 'favorites' | `collection:${string}`;
type ConfirmState =
  | { type: 'case'; id: string; title: string }
  | { type: 'collection'; id: string; name: string }
  | { type: 'clear-guides'; caseId: string; title: string }
  | { type: 'replace-main'; caseId: string; images: PicFlowImage[] }
  | { type: 'move-work'; workId: string; fromCollectionName: string; toCollectionId?: string; toCollectionName: string }
  | { type: 'reset-test-data' }
  | null;

const emptyData: PicFlowData = { version: 1, cases: [], collections: [], settings: { theme: 'light', cardScale: 1.12 } };
const modelPresets = ['Nano banana', 'Nano banana Pro', 'GPT Image', 'Midjourney', 'Stable Diffusion', '即梦', '可灵', 'Libli'];
const minCardScale = 0.78;
const maxCardScale = 1.45;
const emptyLibraryState: PicFlowLibraryState = { ready: false, setupRequired: true, missing: false, recentLibraries: [] };

const picflowApi = window.picflow ?? {
  loadData: async () => {
    const raw = localStorage.getItem('picflow-browser-preview');
    return raw ? (JSON.parse(raw) as PicFlowData) : emptyData;
  },
  saveData: async (data: PicFlowData) => {
    localStorage.setItem('picflow-browser-preview', JSON.stringify(data));
    return data;
  },
  getStorageInfo: async () => ({ dataPath: 'Electron 模式下保存到 LOCALAPPDATA', imageDir: 'Electron 模式下保存图片' }),
  selectImages: async () => [],
  getPathForFile: () => '',
  importImagePaths: async () => [],
  saveDataUrlImage: async (dataUrl: string, name?: string) => ({
    id: newId(),
    url: dataUrl,
    name: name ?? 'clipboard-image.png',
    type: 'screenshot' as const,
    addedAt: nowIso()
  }),
  saveUrlImage: async (url: string) => ({
    id: newId(),
    url,
    name: 'image-url',
    type: 'cover' as const,
    addedAt: nowIso()
  }),
  copyImage: async (image: PicFlowImage) => {
    const src = image.url ?? (image.localPath ? `file:///${image.localPath.replace(/\\/g, '/')}` : '');
    if (!src || !navigator.clipboard || !('ClipboardItem' in window)) return false;
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([new (window as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem({ [blob.type]: blob })]);
    return true;
  },
  exportShareCardPng: async (dataUrl: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'picflow-share-card.png';
    link.click();
    return true;
  },
  copyShareCardPng: async (dataUrl: string) => {
    if (!navigator.clipboard || !('ClipboardItem' in window)) return false;
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([new (window as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem({ [blob.type]: blob })]);
    return true;
  },
  openExternal: async (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const picflowWindow = window.picflowWindow ?? {
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  close: async () => undefined
};

const picflowClipboard: PicFlowClipboardApi | undefined = window.picflowClipboard ?? (
  navigator.clipboard
    ? {
        readText: () => navigator.clipboard.readText()
      }
    : undefined
);

const fallbackPicflowLibrary: PicFlowLibraryApi = {
  loadCurrentData: async () => {
    const data = await picflowApi.loadData();
    const state = await fallbackPicflowLibrary.getCurrentLibrary();
    return {
      ok: true,
      state,
      data,
      debug: {
        currentLibraryPath: '',
        worksPath: 'browser-preview/works.json',
        collectionsPath: 'browser-preview/collections.json',
        settingsPath: 'browser-preview/settings.json',
        worksCount: data.cases.length,
        collectionsCount: data.collections.length
      }
    };
  },
  getCurrentLibrary: async () => ({ ready: true, setupRequired: false, missing: false, currentLibrary: { name: '浏览器预览', path: '', lastOpenedAt: nowIso() }, recentLibraries: [] }),
  setupDefaultLibrary: async () => ({ ok: true, message: '已创建默认资源库' }),
  chooseCustomLibrary: async () => ({ ok: false, message: '桌面应用中可选择自定义位置' }),
  createLibrary: async () => ({ ok: false, message: '创建资源库功能开发中' }),
  addLibrary: async () => ({ ok: false, message: '添加资源库功能开发中' }),
  openLibraryLocation: async () => ({ ok: false, message: '暂未找到资源库位置' }),
  switchLibrary: async () => ({ ok: false, message: '资源库不存在或无效' }),
  resetTestData: async () => ({ ok: false, message: '桌面应用中可重置测试数据' })
};

const picflowLibrary = window.picflowLibrary ?? fallbackPicflowLibrary;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function createCase(partial: Partial<PicFlowCase> = {}): PicFlowCase {
  const timestamp = nowIso();
  const images = partial.images ?? [];
  return {
    id: partial.id ?? newId(),
    title: partial.title ?? '',
    status: partial.status ?? 'pending',
    images,
    referenceImages: partial.referenceImages ?? [],
    coverImageId: partial.coverImageId ?? images[0]?.id,
    favorite: partial.favorite ?? false,
    hidden: partial.hidden ?? false,
    collectionId: partial.collectionId,
    modelTags: partial.modelTags ?? [],
    sourceUrl: partial.sourceUrl ?? '',
    captureMethod: partial.captureMethod ?? 'manual',
    capturedAt: partial.capturedAt ?? timestamp,
    createdAt: partial.createdAt ?? timestamp,
    updatedAt: partial.updatedAt ?? timestamp,
    prompt: partial.prompt ?? ''
  };
}

function imageSrc(image?: PicFlowImage, libraryPath?: string): string {
  return resolveWorkImageSrc(image, libraryPath);
}

function coverImage(item: PicFlowCase): PicFlowImage | undefined {
  return item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];
}

function displayTitle(item: PicFlowCase): string {
  return item.title.trim() || '未命名作品';
}

function formatTime(value?: string): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function viewTitle(view: ViewKey, collections: PicFlowCollection[]): string {
  if (view === 'all') return '全部作品';
  if (view === 'pending') return '\u5f85\u6574\u7406';
  if (view === 'favorites') return '我的收藏';
  const collection = collections.find((item) => item.id === view.replace('collection:', ''));
  return collection?.name ?? '灵感图集';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

function isImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return /\.(png|jpe?g|webp|gif|bmp|avif)(\?.*)?$/i.test(trimmed);
}

function nextAfterDelete(cases: PicFlowCase[], deletedId: string): string | null {
  const index = cases.findIndex((item) => item.id === deletedId);
  const next = cases[index + 1] ?? cases[index - 1];
  return next?.id ?? null;
}

export default function App(): JSX.Element {
  const [data, setData] = useState<PicFlowData>(emptyData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>('all');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [cardScale, setCardScale] = useState(1.12);
  const [galleryDragging, setGalleryDragging] = useState(false);
  const [sidePanelsCollapsed, setSidePanelsCollapsed] = useState(() => localStorage.getItem('picflow.sidePanelsCollapsed') === 'true');
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [libraryMenuPosition, setLibraryMenuPosition] = useState({ top: 0, right: 12 });
  const [libraryState, setLibraryState] = useState<PicFlowLibraryState>(emptyLibraryState);
  const [libraryRefreshing, setLibraryRefreshing] = useState(false);
  const [cutWorkId, setCutWorkId] = useState<string | null>(null);
  const [postImportCaseId, setPostImportCaseId] = useState<string | null>(null);
  const [shareCardCaseId, setShareCardCaseId] = useState<string | null>(null);
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null);
  const suppressSaveRef = useRef(false);

  useEffect(() => {
    void loadCurrentLibraryDataAndApply('startup');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    if (!loaded) return;
    setData((current) => ({ ...current, settings: { ...current.settings, theme: darkMode ? 'dark' : 'light' } }));
  }, [darkMode]);

  useEffect(() => {
    if (!loaded) return;
    setData((current) => ({ ...current, settings: { ...current.settings, cardScale } }));
  }, [cardScale]);

  useEffect(() => {
    localStorage.setItem('picflow.sidePanelsCollapsed', String(sidePanelsCollapsed));
  }, [sidePanelsCollapsed]);

  useEffect(() => {
    if (!libraryMenuOpen) return;
    const updatePosition = () => updateLibraryMenuPosition();
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [libraryMenuOpen]);

  useEffect(() => {
    if (!loaded) return;
    if (!libraryState.ready) return;
    if (suppressSaveRef.current) return;
    const timer = window.setTimeout(() => {
      void picflowApi.saveData(data);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, loaded, libraryState.ready]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onPaste = async (event: globalThis.ClipboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-guide-dropzone="true"]')) return;
      if (postImportCaseId) return;
      if (cutWorkId) {
        event.preventDefault();
        pasteCutWorkToCurrentCollection();
        return;
      }
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (!imageFile) return;
      if (!ensureLibraryReady()) return;
      event.preventDefault();
      try {
      const dataUrl = await fileToDataUrl(imageFile);
      const image = await picflowApi.saveDataUrlImage(dataUrl, imageFile.name || 'clipboard-image.png');
        appendWork(createCase({ images: [image], captureMethod: 'clipboard-paste' }), { openPostImportModal: true });
        setToast('\u5df2\u4ece\u526a\u8d34\u677f\u5bfc\u5165\u56fe\u7247');
      } catch {
        setToast('\u56fe\u7247\u4fdd\u5b58\u5931\u8d25');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activeView, cutWorkId, data.cases, data.collections, libraryState.ready, postImportCaseId]);

  const selectedCase = data.cases.find((item) => item.id === selectedId) ?? null;
  const smartClipboard = useSmartClipboard({
    enabled: libraryState.ready,
    selectedWork: selectedCase,
    modalOpen: Boolean(confirmState || postImportCaseId || shareCardCaseId || libraryMenuOpen),
    movingWork: Boolean(cutWorkId),
    clipboardApi: picflowClipboard,
    onReadError: () => setToast('\u65e0\u6cd5\u8bfb\u53d6\u526a\u8d34\u677f')
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      if (postImportCaseId) return;
      if (event.ctrlKey && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        if (!selectedCase) {
          setToast('\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u4f5c\u54c1');
          return;
        }
        setCutWorkId(selectedCase.id);
        setToast('\u5df2\u526a\u5207\u4f5c\u54c1\uff0c\u8bf7\u8fdb\u5165\u76ee\u6807\u56fe\u96c6\u540e\u7c98\u8d34');
        return;
      }
      if (event.key !== 'Delete' || !selectedCase) return;
      event.preventDefault();
      setConfirmState({ type: 'case', id: selectedCase.id, title: displayTitle(selectedCase) });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [postImportCaseId, selectedCase]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-model-combobox="true"]')) setModelOpen(false);
      if (!target?.closest('[data-library-menu="true"]')) setLibraryMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const counts = useMemo(
    () => ({
      all: data.cases.length,
      pending: data.cases.filter((item) => item.status === 'pending').length,
      favorites: data.cases.filter((item) => item.favorite).length
    }),
    [data.cases]
  );

  const visibleCases = useMemo(() => {
    let scoped = data.cases;
    if (activeView === 'pending') scoped = scoped.filter((item) => item.status === 'pending');
    if (activeView === 'favorites') scoped = scoped.filter((item) => item.favorite);
    if (activeView === 'all') scoped = data.cases;
    if (activeView.startsWith('collection:')) {
      const collectionId = activeView.replace('collection:', '');
      scoped = scoped.filter((item) => item.collectionId === collectionId);
    }
    if (search.trim()) return filterWorksByQuery(scoped, search);
    return scoped;
  }, [activeView, data.cases, search]);

  useEffect(() => {
    if (!selectedId) return;
    if (!visibleCases.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [selectedId, visibleCases]);

  const visibleSelectedCase = selectedId ? visibleCases.find((item) => item.id === selectedId) ?? null : null;
  const postImportCase = postImportCaseId ? data.cases.find((item) => item.id === postImportCaseId) ?? null : null;
  const shareCardCase = shareCardCaseId ? data.cases.find((item) => item.id === shareCardCaseId) ?? null : null;
  const visibleRecentLibraries = useMemo(() => {
    const seen = new Set<string>();
    const currentPath = libraryState.currentLibrary?.path;
    return libraryState.recentLibraries.filter((item) => {
      if (!item.path || item.path === currentPath || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }, [libraryState.currentLibrary?.path, libraryState.recentLibraries]);

  function isTextEditingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return Boolean(
      element?.matches('input, textarea, select') ||
        element?.closest('[contenteditable="true"]') ||
        element?.closest('[role="dialog"]')
    );
  }

  function ensureLibraryReady(): boolean {
    if (libraryState.ready) return true;
    setToast('请先设置资源库');
    return false;
  }

  async function loadCurrentLibraryDataAndApply(
    reason: 'startup' | 'switch' | 'refresh',
    options: { resetView?: boolean; keepSelection?: boolean } = { resetView: true }
  ): Promise<boolean> {
    if (reason === 'refresh') console.info('[library refresh] clicked');

    const result = await picflowLibrary.loadCurrentData();
    const debug = result.debug;
    const prefix = reason === 'switch' ? '[library switch]' : reason === 'refresh' ? '[library refresh]' : '[library startup]';

    if (debug) {
      console.info(`${prefix} currentLibraryPath:`, debug.currentLibraryPath);
      if (reason === 'refresh') {
        console.info('[library refresh] works path:', debug.worksPath);
        console.info('[library refresh] collections path:', debug.collectionsPath);
      }
      console.info(`${prefix} works count:`, debug.worksCount);
      console.info(`${prefix} collections count:`, debug.collectionsCount);
    }

    setLibraryState(result.state);
    if (!result.ok || !result.state.ready || !result.data) {
      if (reason !== 'startup') setToast(result.message ?? '资源库数据读取失败');
      if (!result.state.ready) {
        suppressSaveRef.current = true;
        setData(emptyData);
        setSelectedId(null);
        window.setTimeout(() => {
          suppressSaveRef.current = false;
        }, 300);
      }
      setLoaded(true);
      return false;
    }

    if (reason === 'refresh') console.info('[library refresh] applying state...');
    suppressSaveRef.current = true;
    const nextData = result.data;
    setData(nextData);
    setDarkMode(nextData.settings?.theme === 'dark');
    setCardScale(nextData.settings?.cardScale ?? 1.12);
    setSelectedId((current) => {
      if (options.keepSelection && current && nextData.cases.some((item) => item.id === current)) return current;
      return null;
    });
    if (options.resetView !== false) {
      setActiveView('all');
      setSearch('');
    } else {
      setActiveView((current) => {
        if (!current.startsWith('collection:')) return current;
        const collectionId = current.replace('collection:', '');
        return nextData.collections.some((item) => item.id === collectionId) ? current : 'all';
      });
    }
    setLoaded(true);
    window.setTimeout(() => {
      suppressSaveRef.current = false;
    }, 300);
    if (reason === 'refresh') console.info('[library refresh] done');
    if (reason === 'switch') console.info('[library switch] state applied');
    return true;
  }

  function persist(nextData: PicFlowData): void {
    setData(nextData);
    void picflowApi.saveData(nextData);
  }

  function updateCase(id: string, patch: Partial<PicFlowCase>): void {
    setData((current) => ({
      ...current,
      cases: updateWork(current.cases, id, patch, nowIso())
    }));
  }

  function fillPromptFromSmartClipboard(): void {
    const request = smartClipboard.completeRequest();
    if (!request) return;
    setData((current) => {
      const nextData = {
        ...current,
        cases: updateWork(current.cases, request.workId, { prompt: request.text }, nowIso())
      };
      void picflowApi.saveData(nextData);
      return nextData;
    });
    setToast('\u5df2\u586b\u5165 Prompt');
  }

  function appendWork(item: PicFlowCase, options: { openPostImportModal?: boolean } = {}): void {
    setData((current) => {
      const nextData = { ...current, cases: [item, ...current.cases] };
      void picflowApi.saveData(nextData);
      return nextData;
    });
    setSelectedId(item.id);
    setActiveView(item.status === 'pending' ? 'pending' : 'all');
    if (options.openPostImportModal) setPostImportCaseId(item.id);
  }

  function appendWorks(items: PicFlowCase[]): void {
    if (!items.length) return;
    setData((current) => {
      const nextData = { ...current, cases: [...items, ...current.cases] };
      void picflowApi.saveData(nextData);
      return nextData;
    });
    setSelectedId(items[0].id);
    setActiveView(items[0].status === 'pending' ? 'pending' : 'all');
  }

  function addMainImagesToCase(caseId: string, images: PicFlowImage[]): void {
    setData((current) => {
      const nextData = {
        ...current,
        cases: current.cases.map((item) => {
        if (item.id !== caseId) return item;
        const nextImages = [...images, ...item.images];
        return { ...item, images: nextImages, coverImageId: images[0]?.id ?? item.coverImageId, updatedAt: nowIso() };
        })
      };
      void picflowApi.saveData(nextData);
      return nextData;
    });
  }

  function addGuideImagesToCase(caseId: string, images: PicFlowImage[]): void {
    setData((current) => {
      const nextData = {
        ...current,
        cases: current.cases.map((item) => {
        if (item.id !== caseId) return item;
        return { ...item, referenceImages: [...(item.referenceImages ?? []), ...images], updatedAt: nowIso() };
        })
      };
      void picflowApi.saveData(nextData);
      return nextData;
    });
  }

  function removeGuideImage(caseId: string, imageId: string): void {
    setData((current) => {
      const nextData = {
        ...current,
        cases: current.cases.map((item) =>
          item.id === caseId
            ? { ...item, referenceImages: (item.referenceImages ?? []).filter((image) => image.id !== imageId), updatedAt: nowIso() }
            : item
        )
      };
      void picflowApi.saveData(nextData);
      return nextData;
    });
  }

  function clearGuideImages(caseId: string): void {
    updateCase(caseId, { referenceImages: [] });
    setToast('已清空垫图');
  }

  async function importImages(status: PicFlowCase['status'] = 'pending'): Promise<void> {
    if (!ensureLibraryReady()) return;
    try {
      const images = await picflowApi.selectImages();
      if (!images.length) return;
      const works = images.map((image) => createCase({ images: [image], status, captureMethod: 'local-import' }));
      if (works.length === 1) {
        appendWork(works[0], { openPostImportModal: true });
        setToast('\u5df2\u5bfc\u5165\u56fe\u7247');
        return;
      }
      appendWorks(works);
      setToast(`\u5df2\u5bfc\u5165 ${works.length} \u5f20\u56fe\u7247`);
    } catch {
      setToast('\u56fe\u7247\u5bfc\u5165\u5931\u8d25');
    }
  }

  async function addMainImagesToSelected(): Promise<void> {
    if (!selectedCase) return;
    if (!ensureLibraryReady()) return;
    const images = await picflowApi.selectImages();
    if (!images.length) return;
    addMainImagesToCase(selectedCase.id, images);
    setToast('已更新主图');
  }

  async function addGuideImagesToSelected(): Promise<void> {
    if (!selectedCase) return;
    if (!ensureLibraryReady()) return;
    const images = await picflowApi.selectImages('reference');
    if (!images.length) return;
    addGuideImagesToCase(selectedCase.id, images);
    setToast('已添加垫图');
  }

  async function addGuideImagesToImportedCase(caseId: string): Promise<void> {
    if (!ensureLibraryReady()) return;
    try {
      const images = await picflowApi.selectImages('reference');
      if (!images.length) return;
      addGuideImagesToCase(caseId, images);
      setToast('\u5df2\u6dfb\u52a0\u57ab\u56fe');
    } catch {
      setToast('\u57ab\u56fe\u6dfb\u52a0\u5931\u8d25');
    }
  }

  async function importDroppedImages(event: DragEvent<HTMLElement>, target: 'asset' | 'reference' = 'asset'): Promise<PicFlowImage[]> {
    event.preventDefault();
    event.stopPropagation();
    if (!ensureLibraryReady()) return [];

    const files = Array.from(event.dataTransfer.files ?? []);
    const imageFiles = files.filter(isImageFile);
    if (!imageFiles.length) {
      if (files.length) setToast('不支持该文件类型');
      return [];
    }

    const paths = imageFiles
      .map((file) => (picflowApi.getPathForFile?.(file) || (file as File & { path?: string }).path || '').trim())
      .filter((path): path is string => Boolean(path));
    if (!paths.length) {
      setToast('不支持该文件类型');
      return [];
    }
    try {
      return await picflowApi.importImagePaths(paths, target);
    } catch {
      setToast(target === 'reference' ? '\u56fe\u7247\u4fdd\u5b58\u5931\u8d25' : '\u56fe\u7247\u5bfc\u5165\u5931\u8d25');
      return [];
    }
  }

  async function handleGalleryDrop(event: DragEvent<HTMLElement>): Promise<void> {
    setGalleryDragging(false);
    const images = await importDroppedImages(event, 'asset');
    if (!images.length) return;
    const works = images.map((image) => createCase({ images: [image], captureMethod: 'drag-drop' }));
    if (works.length === 1) {
      appendWork(works[0], { openPostImportModal: true });
      setToast('\u5df2\u5bfc\u5165\u56fe\u7247');
      return;
    }
    appendWorks(works);
    setToast(`\u5df2\u5bfc\u5165 ${works.length} \u5f20\u56fe\u7247`);
  }

  async function handleGuideDrop(event: DragEvent<HTMLElement>, caseId: string): Promise<void> {
    const images = await importDroppedImages(event, 'reference');
    if (!images.length) return;
    addGuideImagesToCase(caseId, images);
    setToast('已添加垫图');
  }

  async function handleMainImageDrop(event: DragEvent<HTMLElement>, item: PicFlowCase): Promise<void> {
    const images = await importDroppedImages(event, 'asset');
    if (!images.length) return;
    if (item.images.length > 0) {
      setConfirmState({ type: 'replace-main', caseId: item.id, images });
      return;
    }
    addMainImagesToCase(item.id, images);
    setToast('已更新主图');
  }

  async function handleGuidePaste(event: ReactClipboardEvent<HTMLElement>, caseId: string): Promise<void> {
    event.stopPropagation();
    const imageFile = Array.from(event.clipboardData.files ?? []).find((file) => file.type.startsWith('image/'));
    if (!imageFile) return;
    if (!ensureLibraryReady()) return;
    event.preventDefault();
    try {
      const dataUrl = await fileToDataUrl(imageFile);
      const image = await picflowApi.saveDataUrlImage(dataUrl, imageFile.name || 'guide-image.png', 'reference');
      addGuideImagesToCase(caseId, [image]);
      setToast('\u5df2\u6dfb\u52a0\u57ab\u56fe');
    } catch {
      setToast('\u56fe\u7247\u4fdd\u5b58\u5931\u8d25');
    }
  }

  async function addUrlImage(urlValue: string): Promise<void> {
    const url = urlValue.trim();
    if (!url) return;
    if (!ensureLibraryReady()) return;
    try {
      const image = await picflowApi.saveUrlImage(url);
      appendWork(createCase({ images: [image], captureMethod: 'url-paste', sourceUrl: url }), { openPostImportModal: true });
      setSearch('');
      setToast('\u5df2\u901a\u8fc7\u94fe\u63a5\u6dfb\u52a0\u4f5c\u54c1');
    } catch {
      setToast('\u6682\u4e0d\u652f\u6301\u8be5\u94fe\u63a5');
    }
  }

  function handleSmartInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    const value = search.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) return;
    if (!isImageUrl(value)) {
      setToast('不支持的图片链接');
      return;
    }
    event.preventDefault();
    void addUrlImage(value);
  }

  function toggleOrganizedStatus(id: string): void {
    const item = data.cases.find((work) => work.id === id);
    if (!item) return;
    const nextStatus: PicFlowCase['status'] = item.status === 'pending' ? 'confirmed' : 'pending';
    updateCase(id, { status: nextStatus });
    setToast(nextStatus === 'confirmed' ? '\u5df2\u6574\u7406\u5b8c\u6210' : '\u5df2\u6807\u8bb0\u4e3a\u5f85\u6574\u7406');
  }

  async function savePostImportInfo(caseId: string, payload: PostImportInfoPayload): Promise<void> {
    const nextData = {
      ...data,
      cases: data.cases.map((item) =>
        item.id === caseId
          ? {
              ...item,
              prompt: payload.prompt,
              modelTags: payload.modelTags,
              collectionId: payload.collectionId,
              status: 'confirmed' as const,
              updatedAt: nowIso()
            }
          : item
      )
    };
    try {
      await picflowApi.saveData(nextData);
      setData(nextData);
      setPostImportCaseId(null);
      setToast('\u5df2\u4fdd\u5b58\u4f5c\u54c1\u4fe1\u606f');
    } catch {
      setToast('\u4fdd\u5b58\u5931\u8d25');
    }
  }

  function skipPostImportInfo(): void {
    setPostImportCaseId(null);
    setToast('\u5df2\u8df3\u8fc7\uff0c\u53ef\u7a0d\u540e\u6574\u7406');
  }

  function copyText(value: string | undefined, label: string): void {
    const text = value?.trim();
    if (!text) {
      if (label === 'Prompt') setToast('\u6682\u65e0 Prompt \u53ef\u590d\u5236');
      else if (label === '\u6a21\u578b\u6807\u7b7e') setToast('\u6682\u65e0\u6a21\u578b\u6807\u7b7e\u53ef\u590d\u5236');
      else setToast(`${label}\u4e3a\u7a7a`);
      return;
    }
    void copyTextToClipboard(text).then(() => setToast(`\u5df2\u590d\u5236${label}`)).catch(() => setToast('\u590d\u5236\u5931\u8d25'));
  }

  async function copyImage(image?: PicFlowImage, label = '\u56fe\u7247'): Promise<void> {
    if (!image) {
      setToast(`\u590d\u5236${label}\u5931\u8d25`);
      return;
    }
    try {
      const copied = await picflowApi.copyImage(image);
      setToast(copied ? `\u5df2\u590d\u5236${label}` : `\u590d\u5236${label}\u5931\u8d25`);
    } catch {
      setToast(`\u590d\u5236${label}\u5931\u8d25`);
    }
  }

  function copyModelTags(item: PicFlowCase): void {
    copyText(formatModelTagsForCopy(item), '\u6a21\u578b\u6807\u7b7e');
  }

  function copyWorkSummary(item: PicFlowCase): void {
    const summary = buildWorkSummaryText(item);
    void copyTextToClipboard(summary).then(() => setToast('\u5df2\u590d\u5236\u4f5c\u54c1\u4fe1\u606f')).catch(() => setToast('\u590d\u5236\u5931\u8d25'));
  }

  function toggleFavorite(id: string): void {
    const item = data.cases.find((work) => work.id === id);
    if (!item) return;
    setData((current) => {
      const nextData = {
        ...current,
        cases: current.cases.map((work) => (work.id === id ? { ...work, favorite: !item.favorite, updatedAt: nowIso() } : work))
      };
      void picflowApi.saveData(nextData);
      return nextData;
    });
    setToast(item.favorite ? '\u5df2\u53d6\u6d88\u6536\u85cf' : '\u5df2\u6536\u85cf');
  }

  function collectionName(collectionId?: string): string {
    if (!collectionId) return '\u672a\u5206\u7c7b';
    return data.collections.find((collection) => collection.id === collectionId)?.name ?? '\u672a\u77e5\u56fe\u96c6';
  }

  function applyWorkCollectionMove(workId: string, targetCollectionId?: string): void {
    const targetName = collectionName(targetCollectionId);
    setData((current) => {
      const nextData = {
        ...current,
        cases: current.cases.map((work) =>
          work.id === workId ? { ...work, collectionId: targetCollectionId || undefined, updatedAt: nowIso() } : work
        )
      };
      void picflowApi.saveData(nextData);
      return nextData;
    });
    setCutWorkId((current) => (current === workId ? null : current));
    setToast(targetCollectionId ? `\u5df2\u79fb\u52a8\u5230\u300c${targetName}\u300d` : '\u5df2\u79fb\u51fa\u56fe\u96c6');
  }

  function requestMoveWorkToCollection(workId: string, targetCollectionId?: string): void {
    const work = data.cases.find((item) => item.id === workId);
    if (!work) {
      setToast('\u79fb\u52a8\u5931\u8d25');
      return;
    }
    if (targetCollectionId && !data.collections.some((collection) => collection.id === targetCollectionId)) {
      setToast('\u79fb\u52a8\u5931\u8d25');
      return;
    }
    const currentCollectionId = work.collectionId || undefined;
    if ((currentCollectionId ?? '') === (targetCollectionId ?? '')) {
      setToast(targetCollectionId ? '\u8be5\u4f5c\u54c1\u5df2\u5728\u5f53\u524d\u56fe\u96c6\u4e2d' : '\u5df2\u79fb\u51fa\u56fe\u96c6');
      return;
    }
    if (currentCollectionId && targetCollectionId) {
      setConfirmState({
        type: 'move-work',
        workId,
        fromCollectionName: collectionName(currentCollectionId),
        toCollectionId: targetCollectionId,
        toCollectionName: collectionName(targetCollectionId)
      });
      return;
    }
    applyWorkCollectionMove(workId, targetCollectionId);
  }

  function pasteCutWorkToCurrentCollection(): void {
    if (!cutWorkId) return;
    if (!activeView.startsWith('collection:')) {
      setToast('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u56fe\u96c6\u540e\u518d\u7c98\u8d34\u4f5c\u54c1');
      return;
    }
    const targetCollectionId = activeView.replace('collection:', '');
    requestMoveWorkToCollection(cutWorkId, targetCollectionId);
  }

  function handleWorkCardDragStart(event: DragEvent<HTMLElement>, workId: string): void {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-picflow-work-id', workId);
    setSelectedId(workId);
  }

  function handleCollectionDragOver(event: DragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes('application/x-picflow-work-id')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  }

  function isWorkCardDrag(event: DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types).includes('application/x-picflow-work-id');
  }

  function handleCollectionDrop(event: DragEvent<HTMLElement>, collection: PicFlowCollection): void {
    const workId = event.dataTransfer.getData('application/x-picflow-work-id');
    if (!workId) return;
    event.preventDefault();
    event.stopPropagation();
    requestMoveWorkToCollection(workId, collection.id);
  }

  function addCollection(): void {
    const timestamp = nowIso();
    const collection: PicFlowCollection = { id: newId(), name: '新建图集', createdAt: timestamp, updatedAt: timestamp };
    setData((current) => ({ ...current, collections: [...current.collections, collection] }));
    setActiveView(`collection:${collection.id}`);
    setEditingCollectionId(collection.id);
    setEditingCollectionName(collection.name);
  }

  function startRenameCollection(collection: PicFlowCollection): void {
    setEditingCollectionId(collection.id);
    setEditingCollectionName(collection.name);
  }

  function finishRenameCollection(id: string): void {
    const name = editingCollectionName.trim() || '新建图集';
    setData((current) => ({
      ...current,
      collections: current.collections.map((item) => (item.id === id ? { ...item, name, updatedAt: nowIso() } : item))
    }));
    setEditingCollectionId(null);
    setEditingCollectionName('');
  }

  function cancelRenameCollection(): void {
    setEditingCollectionId(null);
    setEditingCollectionName('');
  }

  async function deleteConfirmed(): Promise<void> {
    if (!confirmState) return;
    if (confirmState.type === 'case') {
      const nextData = { ...data, cases: data.cases.filter((item) => item.id !== confirmState.id) };
      const nextSelectedId = selectedId === confirmState.id ? nextAfterDelete(data.cases, confirmState.id) : selectedId;
      persist(nextData);
      setSelectedId(nextSelectedId);
      setToast('已删除作品');
    }
    if (confirmState.type === 'collection') {
      const nextData = {
        ...data,
        collections: data.collections.filter((item) => item.id !== confirmState.id),
        cases: data.cases.map((item) =>
          item.collectionId === confirmState.id ? { ...item, collectionId: undefined, updatedAt: nowIso() } : item
        )
      };
      persist(nextData);
      if (activeView === `collection:${confirmState.id}`) setActiveView('all');
      setToast('已删除图集，作品已回到未分类');
    }
    if (confirmState.type === 'clear-guides') {
      clearGuideImages(confirmState.caseId);
    }
    if (confirmState.type === 'replace-main') {
      addMainImagesToCase(confirmState.caseId, confirmState.images);
      setToast('已更新主图');
    }
    if (confirmState.type === 'move-work') {
      applyWorkCollectionMove(confirmState.workId, confirmState.toCollectionId);
    }
    if (confirmState.type === 'reset-test-data') {
      const result = await picflowLibrary.resetTestData();
      setToast(result.backupPath ? `${result.message}，备份已保存` : result.message);
      if (result.state) setLibraryState(result.state);
      if (result.ok) {
        setData(emptyData);
        setSelectedId(null);
      }
    }
    setConfirmState(null);
  }

  function addModelTag(nextTag?: string): void {
    if (!selectedCase) return;
    const tag = (nextTag ?? modelDraft).trim();
    if (!tag) return;
    const current = selectedCase.modelTags ?? [];
    if (!current.includes(tag)) updateCase(selectedCase.id, { modelTags: [...current, tag] });
    setModelDraft('');
  }

  function removeModelTag(tag: string): void {
    if (!selectedCase) return;
    updateCase(selectedCase.id, { modelTags: (selectedCase.modelTags ?? []).filter((item) => item !== tag) });
  }

  function handleGalleryWheel(event: WheelEvent<HTMLElement>): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setCardScale((current) => {
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      return Math.min(maxCardScale, Math.max(minCardScale, Number((current + delta).toFixed(2))));
    });
  }

  function updateLibraryMenuPosition(): void {
    const rect = libraryButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLibraryMenuPosition({
      top: Math.min(rect.bottom + 8, window.innerHeight - 190),
      right: Math.max(12, window.innerWidth - rect.right)
    });
  }

  function toggleLibraryMenu(): void {
    if (!libraryMenuOpen) updateLibraryMenuPosition();
    setLibraryMenuOpen((value) => !value);
  }

  async function runLibraryAction(action: 'create' | 'add' | 'open'): Promise<void> {
    setLibraryMenuOpen(false);
    const result =
      action === 'create'
        ? await picflowLibrary.createLibrary()
        : action === 'add'
          ? await picflowLibrary.addLibrary()
          : await picflowLibrary.openLibraryLocation();
    setToast(result.message);
    if (result.state) setLibraryState(result.state);
    if (result.ok && action !== 'open') await loadCurrentLibraryDataAndApply('switch', { resetView: true });
  }

  async function switchRecentLibrary(path: string): Promise<void> {
    setLibraryMenuOpen(false);
    console.info('[library switch] target path:', path);
    const result = await picflowLibrary.switchLibrary(path);
    setToast(result.message);
    if (result.state) setLibraryState(result.state);
    if (result.ok) {
      console.info('[library switch] switch success');
      await loadCurrentLibraryDataAndApply('switch', { resetView: true });
    }
  }

  async function refreshCurrentLibrary(): Promise<void> {
    if (libraryRefreshing) return;
    setLibraryRefreshing(true);
    try {
      const ok = await loadCurrentLibraryDataAndApply('refresh', { resetView: false, keepSelection: true });
      if (ok) setToast('已刷新资源库');
    } catch {
      setToast('资源库刷新失败');
    } finally {
      window.setTimeout(() => setLibraryRefreshing(false), 500);
    }
  }

  async function setupLibrary(action: 'default' | 'custom' | 'add' | 'create'): Promise<void> {
    const result =
      action === 'default'
        ? await picflowLibrary.setupDefaultLibrary()
        : action === 'custom'
          ? await picflowLibrary.chooseCustomLibrary()
          : action === 'add'
            ? await picflowLibrary.addLibrary()
            : await picflowLibrary.createLibrary();
    setToast(result.message);
    if (result.state) setLibraryState(result.state);
    if (result.ok) await loadCurrentLibraryDataAndApply('switch', { resetView: true });
  }

  const cardWidth = Math.round(200 * cardScale);
  const cardHeight = Math.round(260 * cardScale);
  const cardGap = Math.round(18 * cardScale);
  const getImageDisplaySrc = (image?: PicFlowImage) => imageSrc(image, libraryState.currentLibrary?.path);
  const getReferenceImageDisplaySrc = (image?: PicFlowImage) => imageSrc(image, libraryState.currentLibrary?.path);

  return (
    <div
      className="flex h-screen flex-col bg-[#e8ebe7] text-ink dark:bg-[#242424] dark:text-neutral-100"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <AppTitlebar
        currentViewTitle={search.trim() ? '\u641c\u7d22\u7ed3\u679c' : viewTitle(activeView, data.collections)}
        search={search}
        sidePanelsCollapsed={sidePanelsCollapsed}
        darkMode={darkMode}
        libraryRefreshing={libraryRefreshing}
        libraryButtonRef={libraryButtonRef}
        windowApi={picflowWindow}
        onSearchChange={setSearch}
        onSearchKeyDown={handleSmartInputKeyDown}
        onToggleSidePanels={() => setSidePanelsCollapsed((value) => !value)}
        onToggleLibraryMenu={toggleLibraryMenu}
        onRefreshLibrary={() => void refreshCurrentLibrary()}
        onToggleDarkMode={() => setDarkMode((value) => !value)}
      />

      <main
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: sidePanelsCollapsed ? 'minmax(620px, 1fr)' : '260px minmax(620px, 1fr) 400px' }}
      >
        {!sidePanelsCollapsed && (
        <aside className="flex min-h-0 flex-col bg-[#f4f5f2] dark:bg-[#2b2b2b]">
          <BrandHeader />
          <div className="px-4 py-5">
          <nav className="space-y-1.5">
            <SidebarRow active={activeView === 'all'} icon={<MoreHorizontal />} label="全部作品" count={counts.all} onClick={() => setActiveView('all')} />
            <SidebarRow active={activeView === 'pending'} icon={<Inbox />} label={'\u5f85\u6574\u7406'} count={counts.pending} onClick={() => setActiveView('pending')} />
          </nav>

          <div className="sidebar-collection-section mt-6 border-t border-[#dde2dc] pt-5 dark:border-[#3b3b3b]">
            <SidebarSectionHeader title="灵感图集" onAction={addCollection} />
            <div className="mt-2 space-y-1">
              <SidebarRow active={activeView === 'favorites'} icon={<Heart />} label="我的收藏" count={counts.favorites} onClick={() => setActiveView('favorites')} />
              {data.collections.map((collection) => {
                const collectionCount = data.cases.filter((item) => item.collectionId === collection.id).length;
                return (
                <div
                  key={collection.id}
                  className="group relative"
                  onDragOver={handleCollectionDragOver}
                  onDrop={(event) => handleCollectionDrop(event, collection)}
                >
                  {editingCollectionId === collection.id ? (
                    <input
                      className="field-input h-9 min-w-0 flex-1 px-2"
                      autoFocus
                      value={editingCollectionName}
                      onChange={(event) => setEditingCollectionName(event.target.value)}
                      onBlur={() => finishRenameCollection(collection.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') finishRenameCollection(collection.id);
                        if (event.key === 'Escape') cancelRenameCollection();
                      }}
                    />
                  ) : (
                    <SidebarRow
                      active={activeView === `collection:${collection.id}`}
                      icon={<Folder />}
                      label={collection.name}
                      count={collectionCount}
                      onClick={() => setActiveView(`collection:${collection.id}`)}
                      onDoubleClick={() => startRenameCollection(collection)}
                      title="双击重命名"
                    />
                  )}
                  <button
                    className="sidebar-row-action"
                    onClick={() => setConfirmState({ type: 'collection', id: collection.id, name: collection.name })}
                    aria-label={`删除图集 ${collection.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                );
              })}
            </div>
          </div>
          </div>
        </aside>
        )}

        <section
          className={`min-h-0 overflow-y-auto bg-[#e6eae5] px-7 py-6 transition dark:bg-[#252525] ${galleryDragging ? 'bg-[#e1e6f3] dark:bg-[#2d2b33]' : ''}`}
          onWheel={handleGalleryWheel}
          onDragEnter={(event) => {
            if (isWorkCardDrag(event)) return;
            event.preventDefault();
            setGalleryDragging(true);
          }}
          onDragOver={(event) => {
            if (isWorkCardDrag(event)) return;
            event.preventDefault();
            setGalleryDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setGalleryDragging(false);
          }}
          onDrop={handleGalleryDrop}
        >
          <div className="mb-3 flex h-8 items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.005em] text-stone-700 dark:text-neutral-200">{search.trim() ? '搜索结果' : viewTitle(activeView, data.collections)}</h2>
              <p className="text-xs text-stone-500 dark:text-neutral-500">
                {search.trim() ? '搜索作品、Prompt、模型和来源。' : `${visibleCases.length} 个作品`}
              </p>
            </div>
          </div>

          {visibleCases.length === 0 ? (
            <EmptyState
              dragging={galleryDragging}
              onImport={() => importImages()}
              title={search.trim() ? '\u6ca1\u6709\u627e\u5230\u76f8\u5173\u4f5c\u54c1' : undefined}
              description={search.trim() ? '\u8bd5\u8bd5\u66f4\u6362\u5173\u952e\u8bcd\uff0c\u6216\u6e05\u7a7a\u641c\u7d22\u540e\u67e5\u770b\u5f53\u524d\u89c6\u56fe\u3002' : undefined}
            />
          ) : activeView === 'pending' && !search.trim() ? (
            <div className="grid items-start" style={{ gridTemplateColumns: `repeat(auto-fill, ${cardWidth}px)`, gap: cardGap }}>
              {visibleCases.map((item) => (
                <PendingCard
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                  onCopy={() => copyImage(coverImage(item))}
                  onFavorite={() => toggleFavorite(item.id)}
                  onDelete={() => setConfirmState({ type: 'case', id: item.id, title: displayTitle(item) })}
                  onDragStart={(event) => handleWorkCardDragStart(event, item.id)}
                  cardHeight={cardHeight}
                  getImageSrc={getImageDisplaySrc}
                />
              ))}
            </div>
          ) : (
            <div className="grid items-start" style={{ gridTemplateColumns: `repeat(auto-fill, ${cardWidth}px)`, gap: cardGap }}>
              {visibleCases.map((item) => (
                <CaseCard
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                  onCopy={() => copyImage(coverImage(item))}
                  onFavorite={() => toggleFavorite(item.id)}
                  onDelete={() => setConfirmState({ type: 'case', id: item.id, title: displayTitle(item) })}
                  onDragStart={(event) => handleWorkCardDragStart(event, item.id)}
                  cardHeight={cardHeight}
                  getImageSrc={getImageDisplaySrc}
                />
              ))}
            </div>
          )}
        </section>

        {!sidePanelsCollapsed && (
        <div className="min-h-0 bg-[#e1e6df] p-4 pl-2 dark:bg-[#282828]">
        <DetailPanel
          item={visibleSelectedCase}
          collections={data.collections}
          modelDraft={modelDraft}
          modelOpen={modelOpen}
          onModelDraftChange={setModelDraft}
          onModelOpenChange={setModelOpen}
          onAddModelTag={addModelTag}
          onRemoveModelTag={removeModelTag}
          onUpdate={updateCase}
          onCollectionChange={(item, collectionId) => requestMoveWorkToCollection(item.id, collectionId)}
          onMainImageDrop={handleMainImageDrop}
          onAddGuideImages={addGuideImagesToSelected}
          onGuideDrop={handleGuideDrop}
          onGuidePaste={handleGuidePaste}
          onRemoveGuideImage={removeGuideImage}
          onClearGuideImages={(item) => setConfirmState({ type: 'clear-guides', caseId: item.id, title: displayTitle(item) })}
          onCopyGuideImage={(image) => copyImage(image, '\u57ab\u56fe')}
          onCopyMainImage={(image) => copyImage(image, '\u4e3b\u56fe')}
          onToggleOrganized={toggleOrganizedStatus}
          onOpenShareCard={(item) => setShareCardCaseId(item.id)}
          onCopy={copyText}
          clipboardRequest={smartClipboard.request}
          onSmartClipboardDismiss={smartClipboard.dismissRequest}
          onSmartClipboardFill={fillPromptFromSmartClipboard}
          getImageSrc={getImageDisplaySrc}
        />
        </div>
        )}
      </main>

      {libraryMenuOpen && (
        <div
          className="library-menu"
          data-library-menu="true"
          style={{ top: libraryMenuPosition.top, right: libraryMenuPosition.right }}
        >
          <div className="library-menu-current">当前资源库：{libraryState.currentLibrary?.name ?? '未设置'}</div>
          {visibleRecentLibraries.length > 0 && (
            <>
              <div className="library-menu-section">最近使用</div>
              {visibleRecentLibraries.map((library) => (
                <button key={library.path} type="button" className="library-menu-item" title={library.path} onClick={() => void switchRecentLibrary(library.path)}>
                  {library.name}
                </button>
              ))}
            </>
          )}
          <button type="button" className="library-menu-item" onClick={() => void runLibraryAction('create')}>
            创建新资源库...
          </button>
          <button type="button" className="library-menu-item" onClick={() => void runLibraryAction('add')}>
            添加已有资源库...
          </button>
          <button type="button" className="library-menu-item" onClick={() => void runLibraryAction('open')}>
            打开资源库位置
          </button>
          <button
            type="button"
            className="library-menu-item is-danger"
            onClick={() => {
              setLibraryMenuOpen(false);
              setConfirmState({ type: 'reset-test-data' });
            }}
          >
            重置测试数据（开发用）
          </button>
        </div>
      )}

      {!libraryState.ready && loaded && (
        <LibraryGateDialog
          missing={libraryState.missing}
          onSetupDefault={() => void setupLibrary('default')}
          onChooseCustom={() => void setupLibrary('custom')}
          onAddExisting={() => void setupLibrary('add')}
          onCreateNew={() => void setupLibrary('create')}
        />
      )}

      {postImportCase && (
        <PostImportInfoModal
          item={postImportCase}
          collections={data.collections}
          modelPresets={modelPresets}
          coverSrc={getImageDisplaySrc(coverImage(postImportCase))}
          getImageSrc={getImageDisplaySrc}
          onSkip={skipPostImportInfo}
          onSave={(payload) => savePostImportInfo(postImportCase.id, payload)}
          onAddGuideImages={() => addGuideImagesToImportedCase(postImportCase.id)}
          onGuidePaste={(event) => handleGuidePaste(event, postImportCase.id)}
          onRemoveGuideImage={removeGuideImage}
        />
      )}

      {shareCardCase && (
        <ShareCardModal
          item={shareCardCase}
          api={picflowApi}
          getWorkImageSrc={getImageDisplaySrc}
          getReferenceImageSrc={getReferenceImageDisplaySrc}
          onClose={() => setShareCardCaseId(null)}
          onToast={setToast}
        />
      )}

      <Toast message={toast} />

      {confirmState && <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} onConfirm={deleteConfirmed} />}
    </div>
  );
}

function BrandHeader(): JSX.Element {
  return (
    <div className="brand-header">
      <div className="brand-identity">
        <div className="brand-logo">PF</div>
        <div className="brand-name-block">
          <div className="brand-title">图迹</div>
          <div className="brand-en">PICFLOW</div>
        </div>
      </div>
      <div className="brand-description">AIGC 视觉灵感库</div>
      <div className="brand-studio">by OMG Design Lab</div>
    </div>
  );
}

function LibraryGateDialog({
  missing,
  onSetupDefault,
  onChooseCustom,
  onAddExisting,
  onCreateNew
}: {
  missing: boolean;
  onSetupDefault: () => void;
  onChooseCustom: () => void;
  onAddExisting: () => void;
  onCreateNew: () => void;
}): JSX.Element {
  return (
    <div className="library-gate">
      <div className="library-gate-panel">
        <div className="library-gate-icon">
          <Database className="h-5 w-5" />
        </div>
        <h2>{missing ? '未找到当前资源库' : '设置你的 PicFlow 资源库'}</h2>
        <p>
          {missing
            ? '可能是资源库文件夹被移动、重命名或删除。你可以重新添加已有资源库，或创建一个新的资源库。'
            : '资源库用于保存你的图片、垫图、Prompt、图集和收藏信息。你可以使用默认位置，也可以选择一个自定义文件夹，方便备份和迁移。'}
        </p>
        {missing ? (
          <div className="library-gate-actions">
            <button className="primary-button" onClick={onAddExisting}>添加已有资源库</button>
            <button className="tool-button" onClick={onCreateNew}>创建新资源库</button>
            <button className="tool-button" onClick={onSetupDefault}>使用默认位置</button>
          </div>
        ) : (
          <div className="library-gate-actions">
            <button className="primary-button" onClick={onSetupDefault}>使用默认位置</button>
            <button className="tool-button" onClick={onChooseCustom}>选择自定义位置</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarSectionHeader({ title, onAction }: { title: string; onAction: () => void }): JSX.Element {
  return (
    <div className="sidebar-section-header mb-2">
      <span className="sidebar-section-title">{title}</span>
      <button className="sidebar-section-add" onClick={onAction} aria-label="新建图集" title="新建图集">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function SidebarRow({
  active,
  icon,
  label,
  count,
  onClick,
  onDoubleClick,
  title
}: {
  active: boolean;
  icon: JSX.Element;
  label: string;
  count?: number;
  onClick: () => void;
  onDoubleClick?: () => void;
  title?: string;
}): JSX.Element {
  return (
    <button
      className={`sidebar-row ${active ? 'is-active' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      <span className="sidebar-row-icon">{icon}</span>
      <span className="sidebar-row-label">{label}</span>
      <span className="sidebar-row-count">
        {typeof count === 'number' ? count : ''}
      </span>
    </button>
  );
}

function EmptyState({ dragging, onImport, title, description }: { dragging: boolean; onImport: () => void; title?: string; description?: string }): JSX.Element {
  const defaultTitle = dragging ? '\u677e\u5f00\u4ee5\u5bfc\u5165\u56fe\u7247' : '\u62d6\u5165\u56fe\u7247\uff0c\u5f00\u59cb\u521b\u5efa\u4f60\u7684\u7b2c\u4e00\u4e2a\u4f5c\u54c1';
  const defaultDescription = '\u652f\u6301\u5bfc\u5165\u56fe\u7247\u3001\u62d6\u62fd\u56fe\u7247\u3001\u7c98\u8d34\u622a\u56fe\u3001\u7c98\u8d34\u56fe\u7247\u94fe\u63a5';

  return (
    <div className="flex min-h-[520px] items-center justify-center p-6">
      <div className="w-full max-w-lg px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[16px] bg-[#e8f1ea] text-[#5f7f69] dark:bg-[#383838] dark:text-neutral-300">
          <ImagePlus className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold tracking-[-0.01em]">{title ?? defaultTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-neutral-400">{description ?? defaultDescription}</p>
        <div className="mt-5 flex justify-center">
          <button className="primary-button" onClick={onImport}>
            <Upload className="h-4 w-4" />
            {'\u5bfc\u5165\u56fe\u7247'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CaseCard({
  item,
  selected,
  onSelect,
  onCopy,
  onFavorite,
  onDelete,
  onDragStart,
  cardHeight,
  getImageSrc
}: {
  item: PicFlowCase;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  cardHeight: number;
  getImageSrc: (image?: PicFlowImage) => string;
}): JSX.Element {
  const cover = item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];
  return (
    <article
      className={`group relative overflow-hidden rounded-[18px] border bg-[#fbfbfa] shadow-[0_10px_28px_rgba(23,32,28,0.055)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,32,28,0.09)] dark:bg-[#303030] ${
        selected ? 'border-[#8faf9b] ring-2 ring-[#8faf9b]/20 dark:border-white/35 dark:ring-white/10' : 'border-[#d8ddd7] dark:border-[#444]'
      } ${selected ? 'is-selected' : ''}`}
      style={{ height: cardHeight }}
      draggable
      onDragStart={onDragStart}
    >
      <button className="block h-full w-full text-left" onClick={onSelect}>
        <div className="relative h-full bg-[#eef0ed] dark:bg-[#383838]">
          {cover ? (
            <img className="h-full w-full object-cover" src={getImageSrc(cover)} alt={displayTitle(item)} loading="lazy" />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-400 dark:text-neutral-500">
              <ImagePlus className="h-9 w-9" />
            </div>
          )}
        </div>
      </button>
      <div className="card-image-overlay" />
      <div className="card-actions">
        <IconButton active={item.favorite} label={'\u6536\u85cf'} onClick={onFavorite}>
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label={'\u590d\u5236\u56fe\u7247'} onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="card-delete-action">
        <IconButton label={'\u5220\u9664\u4f5c\u54c1'} subtleDanger onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </article>
  );
}

function PendingCard({
  item,
  selected,
  onSelect,
  onCopy,
  onFavorite,
  onDelete,
  onDragStart,
  cardHeight,
  getImageSrc
}: {
  item: PicFlowCase;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  cardHeight: number;
  getImageSrc: (image?: PicFlowImage) => string;
}): JSX.Element {
  const cover = item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];
  return (
    <article
      className={`group relative overflow-hidden rounded-[18px] border bg-[#fbfbfa] shadow-[0_10px_28px_rgba(23,32,28,0.055)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,32,28,0.09)] dark:bg-[#303030] ${selected ? 'is-selected border-[#8faf9b] ring-2 ring-[#8faf9b]/20 dark:border-white/35 dark:ring-white/10' : 'border-[#d8ddd7] dark:border-[#444]'}`}
      style={{ height: cardHeight }}
      draggable
      onDragStart={onDragStart}
    >
      <button className="block h-full w-full text-left" onClick={onSelect}>
        <div className="relative h-full bg-stone-100 dark:bg-neutral-800">
          {cover ? <img className="h-full w-full object-cover" src={getImageSrc(cover)} alt={displayTitle(item)} loading="lazy" /> : <div className="flex h-full items-center justify-center text-stone-400 dark:text-neutral-500"><ImagePlus className="h-9 w-9" /></div>}
        </div>
      </button>
      <div className="card-image-overlay" />
      <div className="card-actions">
        <IconButton active={item.favorite} label={'\u6536\u85cf'} onClick={onFavorite}>
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label={'\u590d\u5236\u56fe\u7247'} onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="card-delete-action">
        <IconButton label={'\u5220\u9664\u4f5c\u54c1'} subtleDanger onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </article>
  );
}

function DetailPanel({
  item,
  collections,
  modelDraft,
  modelOpen,
  onModelDraftChange,
  onModelOpenChange,
  onAddModelTag,
  onRemoveModelTag,
  onUpdate,
  onCollectionChange,
  onMainImageDrop,
  onAddGuideImages,
  onGuideDrop,
  onGuidePaste,
  onRemoveGuideImage,
  onClearGuideImages,
  onCopyGuideImage,
  onCopyMainImage,
  onToggleOrganized,
  onOpenShareCard,
  onCopy,
  clipboardRequest,
  onSmartClipboardDismiss,
  onSmartClipboardFill,
  getImageSrc
}: {
  item: PicFlowCase | null;
  collections: PicFlowCollection[];
  modelDraft: string;
  modelOpen: boolean;
  onModelDraftChange: (value: string) => void;
  onModelOpenChange: (value: boolean) => void;
  onAddModelTag: (tag?: string) => void;
  onRemoveModelTag: (tag: string) => void;
  onUpdate: (id: string, patch: Partial<PicFlowCase>) => void;
  onCollectionChange: (item: PicFlowCase, collectionId?: string) => void;
  onMainImageDrop: (event: DragEvent<HTMLElement>, item: PicFlowCase) => void;
  onAddGuideImages: () => void;
  onGuideDrop: (event: DragEvent<HTMLElement>, caseId: string) => void;
  onGuidePaste: (event: ReactClipboardEvent<HTMLElement>, caseId: string) => void;
  onRemoveGuideImage: (caseId: string, imageId: string) => void;
  onClearGuideImages: (item: PicFlowCase) => void;
  onCopyGuideImage: (image: PicFlowImage) => void;
  onCopyMainImage: (image?: PicFlowImage) => void;
  onToggleOrganized: (id: string) => void;
  onOpenShareCard: (item: PicFlowCase) => void;
  onCopy: (value: string | undefined, label: string) => void;
  clipboardRequest: { workId: string; text: string; hasExistingPrompt: boolean } | null;
  onSmartClipboardDismiss: () => void;
  onSmartClipboardFill: () => void;
  getImageSrc: (image?: PicFlowImage) => string;
}): JSX.Element {
  if (!item) {
    return (
    <aside className="flex h-full min-h-0 items-center justify-center rounded-[18px] border border-[#d8ddd7]/75 bg-[#f7f8f5] px-8 text-center shadow-[0_18px_50px_rgba(23,32,28,0.06)] dark:border-[#3b3b3b] dark:bg-[#2f2f2f]">
        <div>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#e8f1ea] text-[#5f7f69] dark:bg-[#383838] dark:text-neutral-300">
            <MoreHorizontal className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold">选择一个作品</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-neutral-400">点击卡片后，可在这里整理主图、垫图、Prompt、模型和来源。</p>
        </div>
      </aside>
    );
  }

  const cover = item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];
  const promptClipboardRequest = clipboardRequest?.workId === item.id ? clipboardRequest : null;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#d8ddd7]/75 bg-[#f7f8f5] shadow-[0_18px_50px_rgba(23,32,28,0.06)] dark:border-[#3b3b3b] dark:bg-[#2f2f2f]">
      <div className="border-b border-[#dde2dc] bg-[#fbfbf8]/90 px-5 py-4 backdrop-blur dark:border-[#3b3b3b] dark:bg-[#303030]/95">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-stone-500 dark:text-neutral-400">作品信息</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-neutral-400">{item.status === 'pending' ? '\u5f85\u6574\u7406\u4f5c\u54c1' : '\u5df2\u6574\u7406\u4f5c\u54c1'}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 pb-8 pt-4">
        <section className="rounded-[16px] bg-[#eef1ec] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:bg-[#292929]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-600 dark:text-neutral-400">主图</span>
            <div className="flex items-center gap-1">
              <button className="icon-button" onClick={() => onCopyMainImage(cover)} aria-label="复制主图" title="复制主图">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div
            className="group relative h-[330px] overflow-hidden rounded-[14px] bg-[#e3e8e2] dark:bg-[#383838]"
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => onMainImageDrop(event, item)}
          >
            {cover ? (
              <img className="h-full w-full object-contain" src={getImageSrc(cover)} alt={displayTitle(item)} />
            ) : (
              <div className="flex h-full items-center justify-center text-stone-400 dark:text-neutral-500">
                <ImagePlus className="h-10 w-10" />
              </div>
            )}
          </div>

          <div
            className="mt-4 border-t border-[#dbe1da]/80 pt-3 outline-none dark:border-[#3f3f3f]"
            data-guide-dropzone="true"
            tabIndex={0}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => onGuideDrop(event, item.id)}
            onPaste={(event) => onGuidePaste(event, item.id)}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-600 dark:text-neutral-400">垫图</span>
                {(item.referenceImages ?? []).length > 0 && (
                  <button className="h-7 rounded-lg px-2 text-xs text-stone-400 transition hover:bg-[#e9ece8] hover:text-[#9d5147] dark:text-neutral-500 dark:hover:bg-[#383838] dark:hover:text-[#d9a19a]" onClick={() => onClearGuideImages(item)}>
                    清空
                  </button>
                )}
            </div>
            <button
              type="button"
              className="mb-3 flex min-h-14 w-full items-center justify-center rounded-[12px] border border-dashed border-[#d7ddd6] bg-[#fbfbfa]/35 px-3 text-center text-xs text-stone-400 transition hover:border-[#bfc9bd] hover:bg-white/55 hover:text-stone-500 dark:border-[#494949] dark:bg-[#333]/45 dark:text-neutral-500 dark:hover:border-[#5c5c5c] dark:hover:bg-[#3a3a3a] dark:hover:text-neutral-300"
              onClick={onAddGuideImages}
            >
              {'\u70b9\u51fb\u3001\u62d6\u62fd\u6216 Ctrl+V \u6dfb\u52a0\u57ab\u56fe'}
            </button>
            {(item.referenceImages ?? []).length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {(item.referenceImages ?? []).map((image) => (
                  <div key={image.id} className="group relative aspect-square overflow-hidden rounded-[12px] border border-[#d8ddd7] bg-white dark:border-[#494949] dark:bg-[#383838]">
                    <img className="h-full w-full object-cover" src={getImageSrc(image)} alt={image.name ?? '垫图'} />
                    <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <button className="icon-button h-7 w-7" onClick={() => onCopyGuideImage(image)} aria-label="复制垫图" title="复制垫图">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button className="icon-button h-7 w-7 text-[#a24f43] dark:text-[#d9a19a]" onClick={() => onRemoveGuideImage(item.id, image.id)} aria-label="删除垫图" title="删除垫图">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[16px] bg-[#fbfbfa] p-3 dark:bg-[#313131]">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-stone-600 dark:text-neutral-400">Prompt</span>
            <button className="icon-button" onClick={() => onCopy(item.prompt, 'Prompt')} aria-label={'\u590d\u5236 Prompt'} title={'\u590d\u5236 Prompt'}>
              <Copy className="h-4 w-4" />
            </button>
          </div>
          {promptClipboardRequest && (
            <ClipboardPromptConfirm
              request={promptClipboardRequest}
              onCancel={onSmartClipboardDismiss}
              onConfirm={onSmartClipboardFill}
            />
          )}
          <textarea
            className="field-input min-h-[230px] resize-y leading-6"
            value={item.prompt ?? ''}
            onChange={(event) => onUpdate(item.id, { prompt: event.target.value })}
          />
        </section>

        <section className="mt-4 space-y-3 px-1">
          <Field label="模型标签">
            <div className="relative" data-model-combobox="true">
              <div className="flex h-10 items-center rounded-[10px] border border-[#d7ddd6] bg-[#fbfbfa] focus-within:border-[#8faf9b] focus-within:ring-2 focus-within:ring-[#8faf9b]/20 dark:border-[#474747] dark:bg-[#343434] dark:focus-within:border-white/35 dark:focus-within:ring-white/10">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-stone-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  value={modelDraft}
                  onFocus={() => onModelOpenChange(true)}
                  onChange={(event) => {
                    onModelDraftChange(event.target.value);
                    onModelOpenChange(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onAddModelTag();
                    if (event.key === 'Escape') onModelOpenChange(false);
                  }}
                  placeholder="选择或输入模型标签"
                />
                <button className="icon-button mr-1" onClick={() => onModelOpenChange(!modelOpen)} aria-label="展开模型标签" title="展开模型标签">
                  <ChevronDown className={`h-4 w-4 transition ${modelOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {modelOpen && (
                <div className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-md border border-[#d8ddd7] bg-white p-1 shadow-soft dark:border-[#494949] dark:bg-[#363636]">
                  {modelPresets
                    .filter((tag) => tag.toLowerCase().includes(modelDraft.trim().toLowerCase()))
                    .map((tag) => (
                      <button
                        key={tag}
                        className="flex h-9 w-full items-center rounded px-2 text-left text-sm text-stone-700 hover:bg-[#eef0ed] dark:text-neutral-200 dark:hover:bg-[#444]"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onAddModelTag(tag);
                          onModelOpenChange(false);
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  {modelDraft.trim() && !modelPresets.includes(modelDraft.trim()) && (
                    <button
                      className="flex h-9 w-full items-center rounded px-2 text-left text-sm text-[#3c6b57] hover:bg-[#eef0ed] dark:text-[#c7c1b6] dark:hover:bg-[#444]"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onAddModelTag();
                        onModelOpenChange(false);
                      }}
                    >
                      添加「{modelDraft.trim()}」
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(item.modelTags ?? []).map((tag) => (
                <button
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-stone-700 hover:border-stone-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  onClick={() => onRemoveModelTag(tag)}
                  title="点击移除"
                >
                  {tag}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          </Field>
          <Field label="所属图集">
            <select className="field-input" value={item.collectionId ?? ''} onChange={(event) => onCollectionChange(item, event.target.value || undefined)}>
              <option value="">未分类</option>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
          </Field>
          <Field label="来源链接">
            <div className="flex gap-2">
              <input className="field-input" value={item.sourceUrl ?? ''} onChange={(event) => onUpdate(item.id, { sourceUrl: event.target.value })} placeholder="https://" />
              <button className="icon-button" onClick={() => item.sourceUrl && picflowApi.openExternal(item.sourceUrl)} aria-label="打开来源链接" title="打开来源链接">
                <Link className="h-4 w-4" />
              </button>
              <button className="icon-button" onClick={() => onCopy(item.sourceUrl, '来源链接')} aria-label="复制来源链接" title="复制来源链接">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </Field>
          <div className="text-xs text-stone-500 dark:text-neutral-400">创建时间：{formatTime(item.createdAt)}</div>
        </section>
      </div>
      <div className="border-t border-[#dde2dc] bg-[#fbfbf8]/95 p-4 dark:border-[#3b3b3b] dark:bg-[#303030]/95">
          <button className="tool-button mb-2 w-full justify-center" onClick={() => onOpenShareCard(item)}>
            生成分享卡
          </button>
          <button className="primary-button mb-2 w-full" onClick={() => onToggleOrganized(item.id)}>
            <Check className="h-4 w-4" />
            {item.status === 'pending' ? '\u6574\u7406\u5b8c\u6210' : '\u6807\u8bb0\u4e3a\u5f85\u6574\u7406'}
          </button>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="field-label dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function IconButton({
  active,
  label,
  children,
  subtleDanger,
  onClick
}: {
  active?: boolean;
  label: string;
  children: ReactNode;
  subtleDanger?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      className={`card-action-button ${active ? 'is-active' : ''} ${subtleDanger ? 'is-danger' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({ state, onCancel, onConfirm }: { state: NonNullable<ConfirmState>; onCancel: () => void; onConfirm: () => void | Promise<void> }): JSX.Element {
  if (state.type === 'move-work') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/45 px-4 backdrop-blur-[2px]">
        <div className="w-full max-w-md rounded-[18px] border border-[#d8ddd7] bg-[#fbfbf8] p-5 shadow-[0_24px_70px_rgba(23,32,28,0.18)] dark:border-[#484848] dark:bg-[#333] dark:text-neutral-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">{'\u79fb\u52a8\u4f5c\u54c1\uff1f'}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-stone-600 dark:text-neutral-300">
                {`\u8be5\u4f5c\u54c1\u5df2\u5b58\u653e\u4e8e\u300c${state.fromCollectionName}\u300d\u56fe\u96c6\u4e2d\u3002\n\n\u6bcf\u4e2a\u4f5c\u54c1\u53ea\u80fd\u5c5e\u4e8e\u4e00\u4e2a\u56fe\u96c6\u3002\n\u662f\u5426\u5c06\u5b83\u79fb\u52a8\u5230\u300c${state.toCollectionName}\u300d\uff1f`}
              </p>
            </div>
            <button className="flex h-9 w-9 items-center justify-center rounded-[10px] text-stone-500 hover:bg-stone-100 dark:text-neutral-400 dark:hover:bg-neutral-800" onClick={onCancel} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="tool-button" onClick={onCancel}>{'\u53d6\u6d88'}</button>
            <button className="primary-button" onClick={() => void onConfirm()}>
              {'\u79fb\u52a8'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  const isCollection = state.type === 'collection';
  const isClearGuides = state.type === 'clear-guides';
  const isReplaceMain = state.type === 'replace-main';
  const isResetTestData = state.type === 'reset-test-data';
  const title = isResetTestData
    ? '确认重置测试数据？'
    : isReplaceMain
      ? '确认替换主图？'
      : isClearGuides
        ? '确认清空垫图？'
        : isCollection
          ? '确认删除图集？'
          : '确认删除作品？';
  const description = isResetTestData
    ? '这会清空当前 PicFlow 的本地测试数据，并让应用下次启动时重新进入资源库初始化流程。此操作仅用于开发测试。'
    : isReplaceMain
      ? '当前作品已有主图。确认后将使用拖入的图片作为新的主图。'
      : isClearGuides
        ? '将移除当前作品的全部垫图，此操作无法撤销。'
        : isCollection
          ? '只会删除图集本身，不会删除其中的作品。图集内作品将回到未分类。'
          : '删除后该作品将从本地作品库中移除，此操作无法撤销。';
  const actionLabel = isReplaceMain ? '替换' : isResetTestData ? '重置' : isClearGuides ? '清空' : '删除';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/45 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-[18px] border border-[#d8ddd7] bg-[#fbfbf8] p-5 shadow-[0_24px_70px_rgba(23,32,28,0.18)] dark:border-[#484848] dark:bg-[#333] dark:text-neutral-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-neutral-300">{description}</p>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-[10px] text-stone-500 hover:bg-stone-100 dark:text-neutral-400 dark:hover:bg-neutral-800" onClick={onCancel} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="tool-button" onClick={onCancel}>取消</button>
          <button className="danger-button" onClick={() => void onConfirm()}>
            {!isReplaceMain && <Trash2 className="h-4 w-4" />}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
