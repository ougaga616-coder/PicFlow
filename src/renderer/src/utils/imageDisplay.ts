import type { PicFlowImage } from '../types';

function isExternalImageSource(value: string): boolean {
  if (isWindowsAbsolutePath(value)) return false;
  return /^(https?|data|blob):/i.test(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\');
}

function joinLibraryPath(libraryPath: string, localPath: string): string {
  const root = libraryPath.replace(/[\\/]+$/, '');
  const child = localPath.replace(/^[\\/]+/, '');
  return `${root}\\${child}`;
}

function normalizeLocalPath(localPath: string, libraryPath?: string): string {
  if (localPath.startsWith('file://')) return decodeURIComponent(localPath.replace(/^file:\/+/, ''));
  if (isWindowsAbsolutePath(localPath) || localPath.startsWith('/')) return localPath;
  return libraryPath ? joinLibraryPath(libraryPath, localPath) : localPath;
}

export function imageDisplaySrc(image?: PicFlowImage, libraryPath?: string): string {
  if (!image) return '';
  if (image.url) return image.url;
  if (!image.localPath) return '';

  if (isExternalImageSource(image.localPath)) return image.localPath;

  const displayPath = normalizeLocalPath(image.localPath, libraryPath);
  const src = `picflow-file://image?path=${encodeURIComponent(displayPath)}`;

  if (import.meta.env.DEV) {
    console.info('[image display] work id:', image.id);
    console.info('[image display] raw image path:', image.localPath);
    console.info('[image display] current library path:', libraryPath ?? '');
    console.info('[image display] normalized display path:', displayPath);
    console.info('[image display] file exists:', 'checked by picflow-file protocol');
  }

  return src;
}
