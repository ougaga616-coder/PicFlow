import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('picflow', {
  loadData: () => ipcRenderer.invoke('picflow:load-data'),
  saveData: (data: unknown) => ipcRenderer.invoke('picflow:save-data', data),
  getStorageInfo: () => ipcRenderer.invoke('picflow:get-storage-info'),
  selectImages: () => ipcRenderer.invoke('picflow:select-images'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  importImagePaths: (filePaths: string[]) => ipcRenderer.invoke('picflow:import-image-paths', filePaths),
  saveDataUrlImage: (dataUrl: string, name?: string) => ipcRenderer.invoke('picflow:save-data-url-image', dataUrl, name),
  copyImage: (image: unknown) => ipcRenderer.invoke('picflow:copy-image', image),
  openExternal: (url: string) => ipcRenderer.invoke('picflow:open-external', url)
});
