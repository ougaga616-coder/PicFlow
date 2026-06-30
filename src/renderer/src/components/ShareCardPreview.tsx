import { useEffect, useRef } from 'react';
import type { PicFlowCase, PicFlowImage } from '../types';
import { coverImage } from '../utils/workDisplay';
import { renderShareCardToCanvas } from '../utils/shareCardCanvas';

type ShareCardPreviewProps = {
  item: PicFlowCase;
  getWorkImageSrc: (image?: PicFlowImage) => string;
  getReferenceImageSrc: (image?: PicFlowImage) => string;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
};

export function ShareCardPreview({ item, getWorkImageSrc, getReferenceImageSrc, onCanvasReady }: ShareCardPreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onCanvasReady?.(canvas);

    let cancelled = false;
    void renderShareCardToCanvas(canvas, {
      mainImageSrc: getWorkImageSrc(coverImage(item)),
      referenceImageSrcs: (item.referenceImages ?? []).map((image) => getReferenceImageSrc(image)),
      prompt: item.prompt ?? '',
      modelTags: item.modelTags ?? []
    }).catch(() => {
      if (!cancelled) onCanvasReady?.(null);
    });

    return () => {
      cancelled = true;
      onCanvasReady?.(null);
    };
  }, [getReferenceImageSrc, getWorkImageSrc, item, onCanvasReady]);

  return (
    <div className="share-card-preview-shell">
      <canvas ref={canvasRef} className="share-card-preview-canvas" aria-label="分享卡片预览" />
    </div>
  );
}
