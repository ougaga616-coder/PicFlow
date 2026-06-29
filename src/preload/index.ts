import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('picflow', {
  loadData: () => ipcRenderer.invoke('picflow:load-data'),
  saveData: (data: unknown) => ipcRenderer.invoke('picflow:save-data', data),
  getStorageInfo: () => ipcRenderer.invoke('picflow:get-storage-info'),
  selectImages: (target?: 'asset' | 'reference') => ipcRenderer.invoke('picflow:select-images', target),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  importImagePaths: (filePaths: string[], target?: 'asset' | 'reference') => ipcRenderer.invoke('picflow:import-image-paths', filePaths, target),
  saveDataUrlImage: (dataUrl: string, name?: string, target?: 'asset' | 'reference') => ipcRenderer.invoke('picflow:save-data-url-image', dataUrl, name, target),
  copyImage: (image: unknown) => ipcRenderer.invoke('picflow:copy-image', image),
  openExternal: (url: string) => ipcRenderer.invoke('picflow:open-external', url)
});

contextBridge.exposeInMainWorld('picflowWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close')
});

contextBridge.exposeInMainWorld('picflowLibrary', {
  getCurrentLibrary: () => ipcRenderer.invoke('library:get-current'),
  setupDefaultLibrary: () => ipcRenderer.invoke('library:setup-default'),
  chooseCustomLibrary: () => ipcRenderer.invoke('library:choose-custom'),
  createLibrary: () => ipcRenderer.invoke('library:create'),
  addLibrary: () => ipcRenderer.invoke('library:add'),
  openLibraryLocation: () => ipcRenderer.invoke('library:open-location'),
  switchLibrary: (path: string) => ipcRenderer.invoke('library:switch', path)
});
