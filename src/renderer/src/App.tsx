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
  Minus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Square,
  Sun,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { ClipboardEvent as ReactClipboardEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { PicFlowCase, PicFlowCollection, PicFlowData, PicFlowImage, PicFlowLibraryApi, PicFlowLibraryState } from './types';

type ViewKey = 'all' | 'pending' | 'favorites' | `collection:${string}`;
type ConfirmState =
  | { type: 'case'; id: string; title: string }
  | { type: 'collection'; id: string; name: string }
  | { type: 'clear-guides'; caseId: string; title: string }
  | { type: 'replace-main'; caseId: string; images: PicFlowImage[] }
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
  copyImage: async (image: PicFlowImage) => {
    const src = image.url ?? (image.localPath ? `file:///${image.localPath.replace(/\\/g, '/')}` : '');
    if (!src || !navigator.clipboard || !('ClipboardItem' in window)) return false;
    const response = await fetch(src);
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

const fallbackPicflowLibrary: PicFlowLibraryApi = {
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

function imageSrc(image?: PicFlowImage): string {
  if (!image) return '';
  if (image.url) return image.url;
  if (!image.localPath) return '';
  return `file:///${image.localPath.replace(/\\/g, '/')}`;
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

function matchesSearch(item: PicFlowCase, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    item.title,
    item.prompt,
    item.sourceUrl,
    ...(item.modelTags ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function viewTitle(view: ViewKey, collections: PicFlowCollection[]): string {
  if (view === 'all') return '全部作品';
  if (view === 'pending') return '待确认';
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
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    void loadCurrentLibrary();
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
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-guide-dropzone="true"]')) return;
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (!imageFile) return;
      const dataUrl = await fileToDataUrl(imageFile);
      const image = await picflowApi.saveDataUrlImage(dataUrl, imageFile.name || 'clipboard-image.png');
      appendWork(createCase({ images: [image], captureMethod: 'clipboard-paste' }));
      setToast('已创建未命名作品');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const selectedCase = data.cases.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !selectedCase) return;
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.matches('input, textarea, select') ||
        Boolean(target?.closest('[contenteditable="true"]'));
      if (isEditing) return;
      event.preventDefault();
      setConfirmState({ type: 'case', id: selectedCase.id, title: displayTitle(selectedCase) });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCase]);

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
      all: data.cases.filter((item) => item.status === 'confirmed').length,
      pending: data.cases.filter((item) => item.status === 'pending').length,
      favorites: data.cases.filter((item) => item.status === 'confirmed' && item.favorite).length
    }),
    [data.cases]
  );

  const visibleCases = useMemo(() => {
    const searched = data.cases.filter((item) => matchesSearch(item, search));
    if (search.trim()) return searched;
    if (activeView === 'all') return searched.filter((item) => item.status === 'confirmed');
    if (activeView === 'pending') return searched.filter((item) => item.status === 'pending');
    if (activeView === 'favorites') return searched.filter((item) => item.status === 'confirmed' && item.favorite);
    const collectionId = activeView.replace('collection:', '');
    return searched.filter((item) => item.collectionId === collectionId && item.status === 'confirmed');
  }, [activeView, data.cases, search]);

  useEffect(() => {
    if (!selectedId) return;
    if (!visibleCases.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [selectedId, visibleCases]);

  const visibleSelectedCase = selectedId ? visibleCases.find((item) => item.id === selectedId) ?? null : null;
  const visibleRecentLibraries = useMemo(() => {
    const seen = new Set<string>();
    const currentPath = libraryState.currentLibrary?.path;
    return libraryState.recentLibraries.filter((item) => {
      if (!item.path || item.path === currentPath || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }, [libraryState.currentLibrary?.path, libraryState.recentLibraries]);

  async function loadCurrentLibrary(nextState?: PicFlowLibraryState, options: { resetView?: boolean } = { resetView: true }): Promise<void> {
    const state = nextState ?? await picflowLibrary.getCurrentLibrary();
    setLibraryState(state);
    if (!state.ready) {
      setData(emptyData);
      setSelectedId(null);
      setLoaded(true);
      return;
    }
    const nextData = await picflowApi.loadData();
    setData(nextData ?? emptyData);
    setDarkMode(nextData?.settings?.theme === 'dark');
    setCardScale(nextData?.settings?.cardScale ?? 1.12);
    setSelectedId(null);
    if (options.resetView !== false) setActiveView('all');
    setLoaded(true);
  }

  function persist(nextData: PicFlowData): void {
    setData(nextData);
    void picflowApi.saveData(nextData);
  }

  function updateCase(id: string, patch: Partial<PicFlowCase>): void {
    setData((current) => ({
      ...current,
      cases: current.cases.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item))
    }));
  }

  function appendWork(item: PicFlowCase): void {
    setData((current) => ({ ...current, cases: [item, ...current.cases] }));
    setSelectedId(item.id);
    setActiveView(item.status === 'pending' ? 'pending' : 'all');
  }

  function addMainImagesToCase(caseId: string, images: PicFlowImage[]): void {
    setData((current) => ({
      ...current,
      cases: current.cases.map((item) => {
        if (item.id !== caseId) return item;
        const nextImages = [...images, ...item.images];
        return { ...item, images: nextImages, coverImageId: images[0]?.id ?? item.coverImageId, updatedAt: nowIso() };
      })
    }));
  }

  function addGuideImagesToCase(caseId: string, images: PicFlowImage[]): void {
    setData((current) => ({
      ...current,
      cases: current.cases.map((item) => {
        if (item.id !== caseId) return item;
        return { ...item, referenceImages: [...(item.referenceImages ?? []), ...images], updatedAt: nowIso() };
      })
    }));
  }

  function removeGuideImage(caseId: string, imageId: string): void {
    updateCase(caseId, {
      referenceImages: selectedCase?.referenceImages?.filter((image) => image.id !== imageId) ?? []
    });
  }

  function clearGuideImages(caseId: string): void {
    updateCase(caseId, { referenceImages: [] });
    setToast('已清空垫图');
  }

  async function importImages(status: PicFlowCase['status'] = 'pending'): Promise<void> {
    const images = await picflowApi.selectImages();
    if (!images.length) return;
    appendWork(createCase({ images, status, captureMethod: 'local-import' }));
    setToast('已创建未命名作品');
  }

  async function addMainImagesToSelected(): Promise<void> {
    if (!selectedCase) return;
    const images = await picflowApi.selectImages();
    if (!images.length) return;
    addMainImagesToCase(selectedCase.id, images);
    setToast('已更新主图');
  }

  async function addGuideImagesToSelected(): Promise<void> {
    if (!selectedCase) return;
    const images = await picflowApi.selectImages('reference');
    if (!images.length) return;
    addGuideImagesToCase(selectedCase.id, images);
    setToast('已添加垫图');
  }

  async function importDroppedImages(event: DragEvent<HTMLElement>, target: 'asset' | 'reference' = 'asset'): Promise<PicFlowImage[]> {
    event.preventDefault();
    event.stopPropagation();

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
    return picflowApi.importImagePaths(paths, target);
  }

  async function handleGalleryDrop(event: DragEvent<HTMLElement>): Promise<void> {
    setGalleryDragging(false);
    const images = await importDroppedImages(event, 'asset');
    if (!images.length) return;
    appendWork(createCase({ images, captureMethod: 'drag-drop' }));
    setToast('已添加作品');
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
    event.preventDefault();
    const dataUrl = await fileToDataUrl(imageFile);
    const image = await picflowApi.saveDataUrlImage(dataUrl, imageFile.name || 'guide-image.png', 'reference');
    addGuideImagesToCase(caseId, [image]);
    setToast('已添加垫图');
  }

  function addUrlImage(urlValue: string): void {
    const url = urlValue.trim();
    if (!url) return;
    const image: PicFlowImage = { id: newId(), url, name: '图片链接', type: 'reference', addedAt: nowIso() };
    appendWork(createCase({ images: [image], captureMethod: 'url-paste', sourceUrl: url }));
    setSearch('');
    setToast('已通过链接添加作品');
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
    addUrlImage(value);
  }

  function confirmCase(id: string): void {
    updateCase(id, { status: 'confirmed' });
    setActiveView('all');
    setToast('已确认入库');
  }

  function copyText(value: string | undefined, label: string): void {
    if (!value?.trim()) {
      setToast(`${label}为空`);
      return;
    }
    void navigator.clipboard.writeText(value).then(() => setToast('已复制'));
  }

  async function copyImage(image?: PicFlowImage): Promise<void> {
    if (!image) {
      setToast('图片复制失败');
      return;
    }
    try {
      const copied = await picflowApi.copyImage(image);
      setToast(copied ? '已复制图片' : '图片复制失败');
    } catch {
      setToast('图片复制失败');
    }
  }

  function toggleFavorite(id: string): void {
    const item = data.cases.find((work) => work.id === id);
    if (!item) return;
    updateCase(id, { favorite: !item.favorite });
    setToast(item.favorite ? '已取消收藏' : '已收藏');
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
    if (result.ok && action !== 'open') await loadCurrentLibrary(result.state);
  }

  async function switchRecentLibrary(path: string): Promise<void> {
    setLibraryMenuOpen(false);
    const result = await picflowLibrary.switchLibrary(path);
    setToast(result.message);
    if (result.state) setLibraryState(result.state);
    if (result.ok) await loadCurrentLibrary(result.state);
  }

  async function refreshCurrentLibrary(): Promise<void> {
    if (libraryRefreshing) return;
    setLibraryRefreshing(true);
    try {
      const state = await picflowLibrary.getCurrentLibrary();
      setLibraryState(state);
      if (!state.ready) {
        setToast('未找到当前资源库');
        await loadCurrentLibrary(state, { resetView: false });
        return;
      }
      await loadCurrentLibrary(state, { resetView: false });
      setToast('已刷新资源库');
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
    if (result.ok) await loadCurrentLibrary(result.state);
  }

  const cardWidth = Math.round(200 * cardScale);
  const cardHeight = Math.round(260 * cardScale);
  const cardGap = Math.round(18 * cardScale);

  return (
    <div
      className="flex h-screen flex-col bg-[#e8ebe7] text-ink dark:bg-[#242424] dark:text-neutral-100"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <header className="app-titlebar">
        <div className="titlebar-brand">
          <span className="titlebar-brand-name">图迹</span>
          <span className="titlebar-separator">/</span>
          <span className="titlebar-current-view">{search.trim() ? '搜索结果' : viewTitle(activeView, data.collections)}</span>
        </div>

        <label className="titlebar-search">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
          <input
            className="smart-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSmartInputKeyDown}
            placeholder="搜索作品 / 粘贴图片链接"
          />
        </label>

        <div className="titlebar-actions">
          <button
            className="toolbar-icon-button"
            onClick={() => setSidePanelsCollapsed((value) => !value)}
            aria-label={sidePanelsCollapsed ? '显示侧栏' : '隐藏侧栏'}
            title={sidePanelsCollapsed ? '显示侧栏' : '隐藏侧栏'}
          >
            {sidePanelsCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>

          <div data-library-menu="true">
            <button
              ref={libraryButtonRef}
              className="toolbar-icon-button"
              onClick={toggleLibraryMenu}
              aria-label="资源库"
              title="资源库"
            >
              <Database className="h-4 w-4" />
            </button>
          </div>

          <button
            className="toolbar-icon-button"
            onClick={() => void refreshCurrentLibrary()}
            disabled={libraryRefreshing}
            aria-label="刷新当前资源库"
            title="刷新当前资源库"
          >
            <RefreshCw className={`h-4 w-4 ${libraryRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button className="toolbar-icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="切换浅色深色模式" title="切换浅色 / 深色模式">
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <WindowControls />
      </header>

      <main
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: sidePanelsCollapsed ? 'minmax(620px, 1fr)' : '260px minmax(620px, 1fr) 384px' }}
      >
        {!sidePanelsCollapsed && (
        <aside className="flex min-h-0 flex-col bg-[#f4f5f2] dark:bg-[#2b2b2b]">
          <BrandHeader />
          <div className="px-4 py-5">
          <nav className="space-y-1.5">
            <SidebarRow active={activeView === 'all'} icon={<MoreHorizontal />} label="全部作品" count={counts.all} onClick={() => setActiveView('all')} />
            <SidebarRow active={activeView === 'pending'} icon={<Inbox />} label="待确认" count={counts.pending} onClick={() => setActiveView('pending')} />
          </nav>

          <div className="sidebar-collection-section mt-6 border-t border-[#dde2dc] pt-5 dark:border-[#3b3b3b]">
            <SidebarSectionHeader title="灵感图集" onAction={addCollection} />
            <div className="mt-2 space-y-1">
              <SidebarRow active={activeView === 'favorites'} icon={<Heart />} label="我的收藏" count={counts.favorites} onClick={() => setActiveView('favorites')} />
              {data.collections.map((collection) => {
                const collectionCount = data.cases.filter((item) => item.status === 'confirmed' && item.collectionId === collection.id).length;
                return (
                <div key={collection.id} className="group relative">
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
            event.preventDefault();
            setGalleryDragging(true);
          }}
          onDragOver={(event) => {
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
            <EmptyState dragging={galleryDragging} onImport={() => importImages()} />
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
                  cardHeight={cardHeight}
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
                  cardHeight={cardHeight}
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
          onMainImageDrop={handleMainImageDrop}
          onAddGuideImages={addGuideImagesToSelected}
          onGuideDrop={handleGuideDrop}
          onGuidePaste={handleGuidePaste}
          onRemoveGuideImage={removeGuideImage}
          onClearGuideImages={(item) => setConfirmState({ type: 'clear-guides', caseId: item.id, title: displayTitle(item) })}
          onCopyGuideImage={(image) => copyText(image.url || image.localPath || image.name, '垫图')}
          onCopyMainImage={(image) => copyImage(image)}
          onConfirm={confirmCase}
          onCopy={copyText}
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

      {toast && <div className="toast">{toast}</div>}

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

function WindowControls(): JSX.Element {
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button className="window-control-button" onClick={() => void picflowWindow.minimize()} aria-label="最小化" title="最小化">
        <Minus className="h-4 w-4" />
      </button>
      <button className="window-control-button" onClick={() => void picflowWindow.toggleMaximize()} aria-label="最大化或还原" title="最大化 / 还原">
        <Square className="h-3.5 w-3.5" />
      </button>
      <button className="window-control-button is-close" onClick={() => void picflowWindow.close()} aria-label="关闭" title="关闭">
        <X className="h-4 w-4" />
      </button>
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

function EmptyState({ dragging, onImport }: { dragging: boolean; onImport: () => void }): JSX.Element {
  return (
    <div className="flex min-h-[520px] items-center justify-center p-6">
      <div className="w-full max-w-lg px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[16px] bg-[#e8f1ea] text-[#5f7f69] dark:bg-[#354038] dark:text-[#afc7b6]">
          <ImagePlus className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold tracking-[-0.01em]">{dragging ? '松开以导入图片' : '拖入图片，开始创建你的第一个作品'}</h3>
        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-neutral-400">支持导入图片、拖拽图片、粘贴截图、粘贴图片链接</p>
        <div className="mt-5 flex justify-center">
          <button className="primary-button" onClick={onImport}>
            <Upload className="h-4 w-4" />
            导入图片
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
  cardHeight
}: {
  item: PicFlowCase;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  cardHeight: number;
}): JSX.Element {
  const cover = item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];
  return (
    <article
      className={`group relative overflow-hidden rounded-[18px] border bg-[#fbfbfa] shadow-[0_10px_28px_rgba(23,32,28,0.055)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,32,28,0.09)] dark:bg-[#303030] ${
        selected ? 'border-[#8faf9b] ring-2 ring-[#8faf9b]/20 dark:border-[#afc7b6] dark:ring-[#afc7b6]/20' : 'border-[#d8ddd7] dark:border-[#444]'
      } ${selected ? 'is-selected' : ''}`}
      style={{ height: cardHeight }}
    >
      <button className="block h-full w-full text-left" onClick={onSelect}>
        <div className="relative h-full bg-[#eef0ed] dark:bg-[#383838]">
          {cover ? (
            <img className="h-full w-full object-cover" src={imageSrc(cover)} alt={displayTitle(item)} loading="lazy" />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-400 dark:text-neutral-500">
              <ImagePlus className="h-9 w-9" />
            </div>
          )}
        </div>
      </button>
      <div className="card-image-overlay" />
      <div className="card-actions">
        <IconButton active={item.favorite} label="收藏" onClick={onFavorite}>
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label="复制图片" onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="card-delete-action">
        <IconButton label="删除" subtleDanger onClick={onDelete}>
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
  cardHeight
}: {
  item: PicFlowCase;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  cardHeight: number;
}): JSX.Element {
  const cover = item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];
  return (
    <article
      className={`group relative overflow-hidden rounded-[18px] border bg-[#fbfbfa] shadow-[0_10px_28px_rgba(23,32,28,0.055)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,32,28,0.09)] dark:bg-[#303030] ${selected ? 'is-selected border-[#8faf9b] ring-2 ring-[#8faf9b]/20 dark:border-[#afc7b6] dark:ring-[#afc7b6]/20' : 'border-[#d8ddd7] dark:border-[#444]'}`}
      style={{ height: cardHeight }}
    >
      <button className="block h-full w-full text-left" onClick={onSelect}>
        <div className="relative h-full bg-stone-100 dark:bg-neutral-800">
          {cover ? <img className="h-full w-full object-cover" src={imageSrc(cover)} alt={displayTitle(item)} loading="lazy" /> : <div className="flex h-full items-center justify-center text-stone-400 dark:text-neutral-500"><ImagePlus className="h-9 w-9" /></div>}
        </div>
      </button>
      <div className="card-image-overlay" />
      <div className="card-actions">
        <IconButton active={item.favorite} label="收藏" onClick={onFavorite}>
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label="复制图片" onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="card-delete-action">
        <IconButton label="删除" subtleDanger onClick={onDelete}>
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
  onMainImageDrop,
  onAddGuideImages,
  onGuideDrop,
  onGuidePaste,
  onRemoveGuideImage,
  onClearGuideImages,
  onCopyGuideImage,
  onCopyMainImage,
  onConfirm,
  onCopy
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
  onMainImageDrop: (event: DragEvent<HTMLElement>, item: PicFlowCase) => void;
  onAddGuideImages: () => void;
  onGuideDrop: (event: DragEvent<HTMLElement>, caseId: string) => void;
  onGuidePaste: (event: ReactClipboardEvent<HTMLElement>, caseId: string) => void;
  onRemoveGuideImage: (caseId: string, imageId: string) => void;
  onClearGuideImages: (item: PicFlowCase) => void;
  onCopyGuideImage: (image: PicFlowImage) => void;
  onCopyMainImage: (image?: PicFlowImage) => void;
  onConfirm: (id: string) => void;
  onCopy: (value: string | undefined, label: string) => void;
}): JSX.Element {
  if (!item) {
    return (
    <aside className="flex h-full min-h-0 items-center justify-center rounded-[18px] border border-[#d8ddd7]/75 bg-[#f7f8f5] px-8 text-center shadow-[0_18px_50px_rgba(23,32,28,0.06)] dark:border-[#3b3b3b] dark:bg-[#2f2f2f]">
        <div>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#e8f1ea] text-[#5f7f69] dark:bg-[#354038] dark:text-[#afc7b6]">
            <MoreHorizontal className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold">选择一个作品</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-neutral-400">点击卡片后，可在这里整理主图、垫图、Prompt、模型和来源。</p>
        </div>
      </aside>
    );
  }

  const cover = item.images.find((image) => image.id === item.coverImageId) ?? item.images[0];

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#d8ddd7]/75 bg-[#f7f8f5] shadow-[0_18px_50px_rgba(23,32,28,0.06)] dark:border-[#3b3b3b] dark:bg-[#2f2f2f]">
      <div className="border-b border-[#dde2dc] bg-[#fbfbf8]/90 px-5 py-4 backdrop-blur dark:border-[#3b3b3b] dark:bg-[#303030]/95">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-stone-500 dark:text-neutral-400">作品信息</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-neutral-400">{item.status === 'pending' ? '待确认作品' : '已入库作品'}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
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
              <img className="h-full w-full object-contain" src={imageSrc(cover)} alt={displayTitle(item)} />
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
              <div className="flex items-center gap-1">
                {(item.referenceImages ?? []).length > 0 && (
                  <button className="h-7 rounded-lg px-2 text-xs text-stone-400 transition hover:bg-[#e9ece8] hover:text-[#9d5147] dark:text-neutral-500 dark:hover:bg-[#383838] dark:hover:text-[#d9a19a]" onClick={() => onClearGuideImages(item)}>
                    清空
                  </button>
                )}
                <button className="icon-button" onClick={onAddGuideImages} aria-label="添加垫图" title="添加垫图">
                  <ImagePlus className="h-4 w-4" />
                </button>
              </div>
            </div>
            {(item.referenceImages ?? []).length === 0 ? (
              <div className="flex h-14 items-center justify-center rounded-[12px] border border-dashed border-[#d7ddd6] bg-[#fbfbfa]/35 px-3 text-center text-xs text-stone-400 dark:border-[#494949] dark:bg-[#333]/45 dark:text-neutral-500">
                拖拽图片到这里，或 Ctrl + V 粘贴为垫图
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {(item.referenceImages ?? []).map((image) => (
                  <div key={image.id} className="group relative aspect-square overflow-hidden rounded-[12px] border border-[#d8ddd7] bg-white dark:border-[#494949] dark:bg-[#383838]">
                    <img className="h-full w-full object-cover" src={imageSrc(image)} alt={image.name ?? '垫图'} />
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
            <button className="icon-button" onClick={() => onCopy(item.prompt, 'Prompt')} aria-label="复制" title="复制">
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <textarea className="field-input min-h-[230px] resize-y leading-6" value={item.prompt ?? ''} onChange={(event) => onUpdate(item.id, { prompt: event.target.value })} />
        </section>

        <section className="mt-5 space-y-3 rounded-[16px] border border-[#dbe1da]/70 bg-[#eef1ec]/45 p-3 dark:border-[#3f3f3f] dark:bg-[#303030]/70">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400 dark:text-neutral-500">生成信息</div>
          <Field label="模型标签">
            <div className="relative" data-model-combobox="true">
              <div className="flex h-10 items-center rounded-[10px] border border-[#d7ddd6] bg-[#fbfbfa] focus-within:border-[#8faf9b] focus-within:ring-2 focus-within:ring-[#8faf9b]/20 dark:border-[#474747] dark:bg-[#343434] dark:focus-within:border-[#afc7b6] dark:focus-within:ring-[#afc7b6]/20">
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
            <select className="field-input" value={item.collectionId ?? ''} onChange={(event) => onUpdate(item.id, { collectionId: event.target.value || undefined })}>
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
      {item.status === 'pending' && (
      <div className="border-t border-[#dde2dc] bg-[#fbfbf8]/95 p-4 dark:border-[#3b3b3b] dark:bg-[#303030]/95">
          <button className="primary-button mb-2 w-full" onClick={() => onConfirm(item.id)}>
            <Check className="h-4 w-4" />
            确认入库
          </button>
      </div>
      )}
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
