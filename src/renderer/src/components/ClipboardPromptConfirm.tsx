export type ClipboardPromptRequest = {
  workId: string;
  text: string;
  hasExistingPrompt: boolean;
};

type ClipboardPromptConfirmProps = {
  request: ClipboardPromptRequest;
  onCancel: () => void;
  onConfirm: () => void;
};

function previewText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 110 ? `${normalized.slice(0, 110)}...` : normalized;
}

export function ClipboardPromptConfirm({ request, onCancel, onConfirm }: ClipboardPromptConfirmProps): JSX.Element {
  const title = request.hasExistingPrompt
    ? '\u68c0\u6d4b\u5230\u526a\u8d34\u677f\u6587\u672c\uff0c\u5f53\u524d\u4f5c\u54c1\u5df2\u6709 Prompt\uff0c\u662f\u5426\u66ff\u6362\uff1f'
    : '\u68c0\u6d4b\u5230\u526a\u8d34\u677f\u6587\u672c\uff0c\u662f\u5426\u586b\u5165 Prompt\uff1f';
  const confirmLabel = request.hasExistingPrompt ? '\u66ff\u6362' : '\u586b\u5165 Prompt';

  return (
    <div className="mb-2 rounded-[12px] border border-[#cbd8cf] bg-[#eef7f0] p-3 shadow-[0_8px_20px_rgba(95,127,105,0.08)] dark:border-black/10 dark:bg-[#dedede] dark:shadow-[0_10px_24px_rgba(0,0,0,0.18)]">
      <div className="text-xs font-semibold leading-5 text-[#3f684b] dark:text-[#222222]">{title}</div>
      <div className="mt-1 max-h-16 overflow-hidden text-xs leading-5 text-stone-600 dark:text-black/60">{previewText(request.text)}</div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="h-8 rounded-[9px] px-2.5 text-xs font-medium text-stone-500 transition hover:bg-white/70 hover:text-stone-700 dark:bg-black/5 dark:text-black/70 dark:hover:bg-black/10 dark:hover:text-black/80" onClick={onCancel}>
          {'\u5ffd\u7565'}
        </button>
        <button className="inline-flex h-8 items-center justify-center rounded-[9px] bg-[#5f7f69] px-2.5 text-xs font-medium text-white transition hover:bg-[#4f6f59] dark:bg-[#222222] dark:text-[#f2f2f2] dark:hover:bg-[#111111]" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
