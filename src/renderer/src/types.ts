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

export type PicFlowApi = {
  loadData: () => Promise<PicFlowData>;
  saveData: (data: PicFlowData) => Promise<PicFlowData>;
  getStorageInfo: () => Promise<StorageInfo>;
  selectImages: () => Promise<PicFlowImage[]>;
  getPathForFile?: (file: File) => string;
  importImagePaths: (filePaths: string[]) => Promise<PicFlowImage[]>;
  saveDataUrlImage: (dataUrl: string, name?: string) => Promise<PicFlowImage>;
  copyImage: (image: PicFlowImage) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
};

export type PicFlowWindowApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};

declare global {
  interface Window {
    picflow?: PicFlowApi;
    picflowWindow?: PicFlowWindowApi;
  }
}
