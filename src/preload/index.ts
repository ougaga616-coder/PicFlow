import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('picflow', {
  loadData: () => ipcRenderer.invoke('picflow:load-data'),
  saveData: (data: unknown) => ipcRenderer.invoke('picflow:save-data', data),
  getStorageInfo: () => ipcRenderer.invoke('picflow:get-storage-info'),
  selectImages: (target?: 'asset' | 'reference') => ipcRenderer.invoke('picflow:select-images', target),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  importImagePaths: (filePaths: string[], target?: 'asset' | 'reference') => ipcRenderer.invoke('picflow:import-image-paths', filePaths, target),
  saveDataUrlImage: (dataUrl: string, name?: string, target?: 'asset' | 'reference') => ipcRenderer.invoke('picflow:save-data-url-image', dataUrl, name, target),
  saveUrlImage: (url: string) => ipcRenderer.invoke('picflow:save-url-image', url),
  copyImage: (image: unknown) => ipcRenderer.invoke('picflow:copy-image', image),
  exportShareCardPng: (dataUrl: string, defaultName?: string) => ipcRenderer.invoke('picflow:export-share-card-png', dataUrl, defaultName),
  copyShareCardPng: (dataUrl: string) => ipcRenderer.invoke('picflow:copy-share-card-png', dataUrl),
  openExternal: (url: string) => ipcRenderer.invoke('picflow:open-external', url)
});

contextBridge.exposeInMainWorld('picflowWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close')
});

contextBridge.exposeInMainWorld('picflowLibrary', {
  getCurrentLibrary: () => ipcRenderer.invoke('library:get-current'),
  loadCurrentData: () => ipcRenderer.invoke('library:load-current-data'),
  setupDefaultLibrary: () => ipcRenderer.invoke('library:setup-default'),
  chooseCustomLibrary: () => ipcRenderer.invoke('library:choose-custom'),
  createLibrary: () => ipcRenderer.invoke('library:create'),
  addLibrary: () => ipcRenderer.invoke('library:add'),
  openLibraryLocation: () => ipcRenderer.invoke('library:open-location'),
  switchLibrary: (path: string) => ipcRenderer.invoke('library:switch', path),
  resetTestData: () => ipcRenderer.invoke('library:reset-test-data')
});
