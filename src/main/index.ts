import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

type PicFlowCaptureMethod = 'manual' | 'local-import' | 'drag-drop' | 'clipboard-paste' | 'url-paste';

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

const emptyData = (): PicFlowData => ({ version: 1, cases: [], collections: [], settings: { theme: 'light', cardScale: 1.12 } });
let mainWindow: BrowserWindow | null = null;

function dataDir(): string {
  const localRoot = process.env.LOCALAPPDATA || app.getPath('userData');
  return join(localRoot, 'PicFlow', 'App', 'local-data');
}

function imageDir(): string {
  return join(dataDir(), 'images');
}

function dataPath(): string {
  return join(dataDir(), 'aigc-flow-library-data.json');
}

function ensureStorage(): void {
  mkdirSync(imageDir(), { recursive: true });
  if (!existsSync(dataPath())) {
    writeFileSync(dataPath(), JSON.stringify(emptyData(), null, 2), 'utf-8');
  }
}

function readData(): PicFlowData {
  ensureStorage();
  try {
    const parsed = JSON.parse(readFileSync(dataPath(), 'utf-8')) as PicFlowData;
    return {
      version: 1,
      cases: Array.isArray(parsed.cases) ? parsed.cases : [],
      collections: Array.isArray(parsed.collections) ? parsed.collections : [],
      settings: parsed.settings ?? { theme: 'light', cardScale: 1.12 }
    };
  } catch {
    return emptyData();
  }
}

function writeData(data: PicFlowData): PicFlowData {
  ensureStorage();
  const normalized: PicFlowData = {
    version: 1,
    cases: Array.isArray(data.cases) ? data.cases : [],
    collections: Array.isArray(data.collections) ? data.collections : [],
    settings: data.settings ?? { theme: 'light', cardScale: 1.12 }
  };
  writeFileSync(dataPath(), JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function copyImageToLibrary(filePath: string): PicFlowImage {
  ensureStorage();
  const extension = extname(filePath) || '.png';
  const id = randomUUID();
  const targetPath = join(imageDir(), `${id}${extension}`);
  copyFileSync(filePath, targetPath);
  return {
    id,
    localPath: targetPath,
    name: basename(filePath),
    type: 'reference',
    addedAt: new Date().toISOString()
  };
}

function saveDataUrlImage(dataUrl: string, name = 'clipboard-image.png'): PicFlowImage {
  ensureStorage();
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('Unsupported image data');
  const mime = match[1];
  const extension = mime.includes('jpeg') ? '.jpg' : `.${mime.split('/')[1] || 'png'}`;
  const id = randomUUID();
  const targetPath = join(imageDir(), `${id}${extension}`);
  writeFileSync(targetPath, Buffer.from(match[2], 'base64'));
  return {
    id,
    localPath: targetPath,
    name,
    type: 'screenshot',
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: '图迹 PicFlow',
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureStorage();

  ipcMain.handle('picflow:load-data', () => readData());
  ipcMain.handle('picflow:save-data', (_event, data: PicFlowData) => writeData(data));
  ipcMain.handle('picflow:get-storage-info', () => ({ dataPath: dataPath(), imageDir: imageDir() }));
  ipcMain.handle('picflow:select-images', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }]
    });
    if (result.canceled) return [];
    return result.filePaths.map(copyImageToLibrary);
  });
  ipcMain.handle('picflow:import-image-paths', (_event, filePaths: string[]) => filePaths.map(copyImageToLibrary));
  ipcMain.handle('picflow:save-data-url-image', (_event, dataUrl: string, name?: string) => saveDataUrlImage(dataUrl, name));
  ipcMain.handle('picflow:copy-image', (_event, image: PicFlowImage) => copyImageToClipboard(image));
  ipcMain.handle('picflow:open-external', (_event, url: string) => {
    if (url) shell.openExternal(url);
  });
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
