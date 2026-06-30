import { ClipboardEvent as ReactClipboardEvent, useEffect, useState } from 'react';
import { Check, ImagePlus, Plus, X } from 'lucide-react';
import type { PicFlowCase, PicFlowCollection, PicFlowImage } from '../types';

export type PostImportInfoPayload = {
  prompt: string;
  modelTags: string[];
  collectionId?: string;
};

type PostImportInfoModalProps = {
  item: PicFlowCase;
  collections: PicFlowCollection[];
  modelPresets: string[];
  coverSrc: string;
  getImageSrc: (image?: PicFlowImage) => string;
  onSkip: () => void;
  onSave: (payload: PostImportInfoPayload) => void | Promise<void>;
  onAddGuideImages: () => void | Promise<void>;
  onGuidePaste: (event: ReactClipboardEvent<HTMLElement>) => void | Promise<void>;
  onRemoveGuideImage: (caseId: string, imageId: string) => void;
};

function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.matches('input, textarea, select') || element?.closest('[contenteditable="true"]'));
}

export function PostImportInfoModal({
  item,
  collections,
  modelPresets,
  coverSrc,
  getImageSrc,
  onSkip,
  onSave,
  onAddGuideImages,
  onGuidePaste,
  onRemoveGuideImage
}: PostImportInfoModalProps): JSX.Element {
  const [prompt, setPrompt] = useState(item.prompt ?? '');
  const [modelDraft, setModelDraft] = useState('');
  const [modelTags, setModelTags] = useState<string[]>(item.modelTags ?? []);
  const [collectionId, setCollectionId] = useState(item.collectionId ?? '');

  useEffect(() => {
    setPrompt(item.prompt ?? '');
    setModelTags(item.modelTags ?? []);
    setCollectionId(item.collectionId ?? '');
    setModelDraft('');
  }, [item.id, item.prompt, item.modelTags, item.collectionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSkip]);

  function addModelTag(value?: string): void {
    const tag = (value ?? modelDraft).trim();
    if (!tag || modelTags.includes(tag)) return;
    setModelTags((current) => [...current, tag]);
    setModelDraft('');
  }

  function removeModelTag(tag: string): void {
    setModelTags((current) => current.filter((item) => item !== tag));
  }

  function modelTagsForSave(): string[] {
    const draft = modelDraft.trim();
    if (!draft || modelTags.includes(draft)) return modelTags;
    return [...modelTags, draft];
  }

  async function handlePaste(event: ReactClipboardEvent<HTMLElement>): Promise<void> {
    if (isTextEditingTarget(event.target)) return;
    const imageFile = Array.from(event.clipboardData.files ?? []).find((file) => file.type.startsWith('image/'));
    if (!imageFile) return;
    event.preventDefault();
    event.stopPropagation();
    await onGuidePaste(event);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onPaste={(event) => void handlePaste(event)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onSkip();
      }}
    >
      <div className="flex max-h-[84vh] w-full max-w-[800px] flex-col overflow-hidden rounded-[20px] border border-[#d8ddd7] bg-[#fbfbf8] shadow-[0_28px_80px_rgba(23,32,28,0.22)] dark:border-[#484848] dark:bg-[#303030] dark:text-neutral-100">
        <div className="flex items-start justify-between gap-4 border-b border-[#dde2dc] px-5 py-3.5 dark:border-[#3b3b3b]">
          <div>
            <h2 className="text-base font-semibold">{'\u8865\u5145\u4f5c\u54c1\u4fe1\u606f'}</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-neutral-400">
              {'\u4f60\u53ef\u4ee5\u73b0\u5728\u8865\u5145\u57ab\u56fe\u3001Prompt\u3001\u6a21\u578b\u548c\u56fe\u96c6\uff0c\u4e5f\u53ef\u4ee5\u8df3\u8fc7\u540e\u7a0d\u540e\u6574\u7406\u3002'}
            </p>
          </div>
          <button className="icon-button" onClick={onSkip} aria-label="关闭" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-2 text-xs font-semibold text-stone-600 dark:text-neutral-400">{'\u4e3b\u56fe\u9884\u89c8'}</div>
            <div className="h-[176px] overflow-hidden rounded-[16px] bg-[#eef1ec] p-2 dark:bg-[#262626]">
              {coverSrc ? (
                <img className="h-full w-full rounded-[12px] object-contain" src={coverSrc} alt="imported work" />
              ) : (
                <div className="flex h-full items-center justify-center text-stone-400">
                  <ImagePlus className="h-10 w-10" />
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-600 dark:text-neutral-400">{'\u57ab\u56fe'}</span>
              <button className="toolbar-icon-button h-8 w-8" onClick={() => void onAddGuideImages()} aria-label="添加垫图" title="添加垫图">
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
            </div>
            {(item.referenceImages ?? []).length === 0 ? (
              <div className="flex h-14 items-center justify-center rounded-[12px] border border-dashed border-[#d7ddd6] bg-[#eef1ec]/45 px-3 text-center text-xs text-stone-400 dark:border-[#494949] dark:bg-[#383838]/45 dark:text-neutral-500">
                {'\u70b9\u51fb\u6dfb\u52a0\u57ab\u56fe\uff0c\u6216\u5728\u5f39\u7a97\u4e2d Ctrl + V \u7c98\u8d34\u4e3a\u57ab\u56fe'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(item.referenceImages ?? []).map((image) => (
                  <div key={image.id} className="group relative h-24 w-24 overflow-hidden rounded-[12px] border border-[#d8ddd7] bg-white dark:border-[#494949] dark:bg-[#383838]">
                    <img className="h-full w-full object-cover" src={getImageSrc(image)} alt={image.name ?? 'guide'} />
                    <button
                      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-lg bg-stone-950/45 text-white opacity-0 transition hover:bg-[#8f3f39] group-hover:opacity-100"
                      onClick={() => onRemoveGuideImage(item.id, image.id)}
                      aria-label="删除垫图"
                      title="删除垫图"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <label className="field-label dark:text-neutral-400">Prompt</label>
            <textarea
              className="field-input min-h-[150px] max-h-[180px] resize-y leading-6"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Prompt"
            />
          </section>

          <section>
            <label className="field-label dark:text-neutral-400">{'\u6a21\u578b\u6807\u7b7e'}</label>
            <div className="rounded-[12px] border border-[#d7ddd6] bg-[#fbfbfa] p-2 transition focus-within:border-[#8faf9b] focus-within:ring-2 focus-within:ring-[#8faf9b]/20 dark:border-[#484848] dark:bg-[#343434] dark:focus-within:border-[#afc7b6] dark:focus-within:ring-[#afc7b6]/20">
              <div className="flex flex-wrap items-center gap-2">
                {modelTags.map((tag) => (
                  <button
                    key={tag}
                    className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-[#d7ddd6] bg-[#eef1ec] px-2.5 text-xs font-medium text-stone-700 transition hover:border-[#c4ccc2] hover:bg-white dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    onClick={() => removeModelTag(tag)}
                  >
                    {tag}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <input
                  className="h-8 min-w-[170px] flex-1 rounded-[8px] bg-transparent px-2 text-sm text-ink outline-none placeholder:text-stone-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  value={modelDraft}
                  onChange={(event) => setModelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addModelTag();
                    }
                  }}
                  placeholder="选择或输入模型标签"
                  list="post-import-model-presets"
                />
                <datalist id="post-import-model-presets">
                  {modelPresets.map((tag) => <option key={tag} value={tag} />)}
                </datalist>
              </div>
            </div>
          </section>

          <section>
            <label className="field-label dark:text-neutral-400">{'\u6240\u5c5e\u56fe\u96c6'}</label>
            <select className="field-input h-10" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
              <option value="">{'\u672a\u5206\u7c7b'}</option>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#dde2dc] bg-[#fbfbf8]/95 px-5 py-3 dark:border-[#3b3b3b] dark:bg-[#303030]/95">
          <button className="tool-button h-9 px-4" onClick={onSkip}>{'\u8df3\u8fc7'}</button>
          <button className="primary-button h-9 px-4" onClick={() => void onSave({ prompt, modelTags: modelTagsForSave(), collectionId: collectionId || undefined })}>
            <Check className="h-4 w-4" />
            {'\u4fdd\u5b58'}
          </button>
        </div>
      </div>
    </div>
  );
}
