import type { PicFlowApi } from '../types';
import { canvasToPngDataUrl } from './shareCardCanvas';

function timestampForFileName(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export async function exportShareCardAsPng(canvas: HTMLCanvasElement, api: PicFlowApi): Promise<boolean> {
  const dataUrl = canvasToPngDataUrl(canvas);
  return api.exportShareCardPng(dataUrl, `picflow-card-${timestampForFileName()}.png`);
}

export async function copyShareCardToClipboard(canvas: HTMLCanvasElement, api: PicFlowApi): Promise<boolean> {
  const dataUrl = canvasToPngDataUrl(canvas);
  return api.copyShareCardPng(dataUrl);
}
