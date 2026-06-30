import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardPromptRequest } from '../components/ClipboardPromptConfirm';
import type { PicFlowCase, PicFlowClipboardApi } from '../types';

type UseSmartClipboardOptions = {
  enabled: boolean;
  selectedWork: PicFlowCase | null;
  modalOpen: boolean;
  movingWork: boolean;
  clipboardApi?: PicFlowClipboardApi;
  onReadError: () => void;
};

type SmartClipboardDetectResult = 'suggested' | 'empty' | 'disabled' | 'blocked' | 'duplicate' | 'error';

type UseSmartClipboardResult = {
  request: ClipboardPromptRequest | null;
  dismissRequest: () => void;
  completeRequest: () => ClipboardPromptRequest | null;
  detectNow: (options?: { manual?: boolean }) => Promise<SmartClipboardDetectResult>;
};

type ClipboardSuggestionKey = {
  workId: string;
  textHash: string;
};

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `${value.length}:${hash >>> 0}`;
}

function sameKey(left: ClipboardSuggestionKey | null, right: ClipboardSuggestionKey): boolean {
  return Boolean(left && left.workId === right.workId && left.textHash === right.textHash);
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.matches('input, textarea, select') ||
      element?.closest('[contenteditable="true"]')
  );
}

export function useSmartClipboard({
  enabled,
  selectedWork,
  modalOpen,
  movingWork,
  clipboardApi,
  onReadError
}: UseSmartClipboardOptions): UseSmartClipboardResult {
  const [request, setRequest] = useState<ClipboardPromptRequest | null>(null);
  const lastDismissedRef = useRef<ClipboardSuggestionKey | null>(null);
  const lastSuggestedRef = useRef<ClipboardSuggestionKey | null>(null);
  const consumedClipboardTextHashRef = useRef<string | null>(null);
  const readingRef = useRef(false);

  useEffect(() => {
    if (!enabled) setRequest(null);
  }, [enabled]);

  useEffect(() => {
    if (!selectedWork || !request) return;
    if (request.workId !== selectedWork.id || request.text === (selectedWork.prompt ?? '').trim()) {
      setRequest(null);
    }
  }, [request, selectedWork]);

  const detectNow = useCallback(async ({ manual = false }: { manual?: boolean } = {}): Promise<SmartClipboardDetectResult> => {
    if (!enabled) return 'disabled';
    if (!selectedWork || modalOpen || movingWork || !clipboardApi?.readText) return 'blocked';
    if (!manual && isTextEditingTarget(document.activeElement)) return 'blocked';
    if (readingRef.current) return 'blocked';

    readingRef.current = true;
    try {
      const rawText = await clipboardApi.readText();
      const text = rawText.trim();
      if (!text) return 'empty';
      const textHash = hashText(text);
      if (textHash === consumedClipboardTextHashRef.current) return 'duplicate';
      if (text === (selectedWork.prompt ?? '').trim()) return 'duplicate';

      const suggestionKey = { workId: selectedWork.id, textHash };
      if (!manual && sameKey(lastDismissedRef.current, suggestionKey)) return 'duplicate';
      if (!manual && sameKey(lastSuggestedRef.current, suggestionKey)) return 'duplicate';

      lastSuggestedRef.current = suggestionKey;
      setRequest({
        workId: selectedWork.id,
        text,
        hasExistingPrompt: Boolean((selectedWork.prompt ?? '').trim())
      });
      return 'suggested';
    } catch {
      onReadError();
      return 'error';
    } finally {
      readingRef.current = false;
    }
  }, [clipboardApi, enabled, modalOpen, movingWork, onReadError, selectedWork]);

  useEffect(() => {
    let timer = 0;
    const scheduleDetect = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void detectNow();
      }, 120);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleDetect();
    };

    window.addEventListener('focus', scheduleDetect);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const removeAppFocusListener = clipboardApi?.onAppFocus?.(scheduleDetect);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', scheduleDetect);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      removeAppFocusListener?.();
    };
  }, [clipboardApi, detectNow]);

  useEffect(() => {
    if (!selectedWork?.id) return;
    const timer = window.setTimeout(() => {
      void detectNow();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [detectNow, selectedWork?.id]);

  const dismissRequest = () => {
    if (request) lastDismissedRef.current = { workId: request.workId, textHash: hashText(request.text) };
    setRequest(null);
  };

  const completeRequest = () => {
    const current = request;
    if (current) {
      const textHash = hashText(current.text);
      lastDismissedRef.current = null;
      lastSuggestedRef.current = { workId: current.workId, textHash };
      consumedClipboardTextHashRef.current = textHash;
    }
    setRequest(null);
    return current;
  };

  return { request, dismissRequest, completeRequest, detectNow };
}
