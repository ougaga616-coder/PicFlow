export type PicFlowCaptureMethod =
  | 'manual'
  | 'local-import'
  | 'drag-drop'
  | 'clipboard-paste'
  | 'url-paste';

export type PicFlowImage = {
  id: string;
  url?: string;
  localPath?: string;
  name?: string;
  type?: 'cover' | 'reference' | 'source' | 'result' | 'screenshot';
  addedAt: string;
};

export type PicFlowCase = {
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

export type PicFlowCollection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PicFlowData = {
  version: 1;
  cases: PicFlowCase[];
  collections: PicFlowCollection[];
  settings?: {
    theme?: 'light' | 'dark';
    cardScale?: number;
  };
};

export type StorageInfo = {
  dataPath: string;
  imageDir: string;
};

export type PicFlowLibraryImageTarget = 'asset' | 'reference';

export type PicFlowApi = {
  loadData: () => Promise<PicFlowData>;
  saveData: (data: PicFlowData) => Promise<PicFlowData>;
  getStorageInfo: () => Promise<StorageInfo>;
  selectImages: (target?: PicFlowLibraryImageTarget) => Promise<PicFlowImage[]>;
  getPathForFile?: (file: File) => string;
  importImagePaths: (filePaths: string[], target?: PicFlowLibraryImageTarget) => Promise<PicFlowImage[]>;
  saveDataUrlImage: (dataUrl: string, name?: string, target?: PicFlowLibraryImageTarget) => Promise<PicFlowImage>;
  saveUrlImage: (url: string) => Promise<PicFlowImage>;
  copyImage: (image: PicFlowImage) => Promise<boolean>;
  exportShareCardPng: (dataUrl: string, defaultName?: string) => Promise<boolean>;
  copyShareCardPng: (dataUrl: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
};

export type PicFlowWindowApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};

export type PicFlowLibraryResult = {
  ok: boolean;
  message: string;
  state?: PicFlowLibraryState;
  backupPath?: string;
};

export type PicFlowLibrarySummary = {
  name: string;
  path: string;
  lastOpenedAt: string;
};

export type PicFlowLibraryState = {
  ready: boolean;
  setupRequired: boolean;
  missing: boolean;
  currentLibrary?: PicFlowLibrarySummary;
  recentLibraries: PicFlowLibrarySummary[];
};

export type PicFlowLibraryLoadResult = {
  ok: boolean;
  message?: string;
  state: PicFlowLibraryState;
  data?: PicFlowData;
  debug?: {
    currentLibraryPath: string;
    worksPath: string;
    collectionsPath: string;
    settingsPath: string;
    worksCount: number;
    collectionsCount: number;
  };
};

export type PicFlowLibraryApi = {
  getCurrentLibrary: () => Promise<PicFlowLibraryState>;
  loadCurrentData: () => Promise<PicFlowLibraryLoadResult>;
  setupDefaultLibrary: () => Promise<PicFlowLibraryResult>;
  chooseCustomLibrary: () => Promise<PicFlowLibraryResult>;
  createLibrary: () => Promise<PicFlowLibraryResult>;
  addLibrary: () => Promise<PicFlowLibraryResult>;
  openLibraryLocation: () => Promise<PicFlowLibraryResult>;
  switchLibrary: (path: string) => Promise<PicFlowLibraryResult>;
  resetTestData: () => Promise<PicFlowLibraryResult>;
};

declare global {
  interface Window {
    picflow?: PicFlowApi;
    picflowWindow?: PicFlowWindowApi;
    picflowLibrary?: PicFlowLibraryApi;
  }
}
