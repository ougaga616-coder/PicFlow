import { useCallback, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import type { PicFlowApi, PicFlowCase, PicFlowImage } from '../types';
import { ShareCardPreview } from './ShareCardPreview';
import { copyShareCardToClipboard, exportShareCardAsPng } from '../utils/shareCardExport';

type ShareCardModalProps = {
  item: PicFlowCase;
  api: PicFlowApi;
  getWorkImageSrc: (image?: PicFlowImage) => string;
  getReferenceImageSrc: (image?: PicFlowImage) => string;
  onClose: () => void;
  onToast: (message: string) => void;
};

export function ShareCardModal({
  item,
  api,
  getWorkImageSrc,
  getReferenceImageSrc,
  onClose,
  onToast
}: ShareCardModalProps): JSX.Element {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState<'copy' | 'export' | null>(null);

  const handleCopy = useCallback(async () => {
    if (!canvas || busy) return;
    setBusy('copy');
    try {
      const copied = await copyShareCardToClipboard(canvas, api);
      onToast(copied ? '已复制分享卡' : '复制分享卡失败');
    } catch {
      onToast('复制分享卡失败');
    } finally {
      setBusy(null);
    }
  }, [api, busy, canvas, onToast]);

  const handleExport = useCallback(async () => {
    if (!canvas || busy) return;
    setBusy('export');
    try {
      const exported = await exportShareCardAsPng(canvas, api);
      onToast(exported ? '已导出分享卡' : '导出失败');
    } catch {
      onToast('导出失败');
    } finally {
      setBusy(null);
    }
  }, [api, busy, canvas, onToast]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[20px] border border-[#d8ddd7] bg-[#fbfbf8] shadow-[0_28px_80px_rgba(23,32,28,0.22)] dark:border-[#484848] dark:bg-[#303030] dark:text-neutral-100">
        <div className="flex items-center justify-between gap-4 border-b border-[#dde2dc] px-5 py-3.5 dark:border-[#3b3b3b]">
          <h2 className="text-base font-medium text-stone-600 dark:text-neutral-300">分享卡片</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#edf1eb] px-4 py-4 dark:bg-[#262a27]">
          <ShareCardPreview
            item={item}
            getWorkImageSrc={getWorkImageSrc}
            getReferenceImageSrc={getReferenceImageSrc}
            onCanvasReady={setCanvas}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-[#dde2dc] bg-[#fbfbf8]/95 px-5 py-3 dark:border-[#3b3b3b] dark:bg-[#303030]/95">
          <button className="tool-button h-9 px-4" onClick={onClose}>
            关闭
          </button>
          <button className="tool-button h-9 px-4" onClick={() => void handleCopy()} disabled={!canvas || Boolean(busy)} title="复制为图片">
            <Copy className="h-4 w-4" />
            复制为图片
          </button>
          <button className="primary-button h-9 px-4" onClick={() => void handleExport()} disabled={!canvas || Boolean(busy)} title="导出 PNG">
            <Download className="h-4 w-4" />
            导出 PNG
          </button>
        </div>
      </div>
    </div>
  );
}
