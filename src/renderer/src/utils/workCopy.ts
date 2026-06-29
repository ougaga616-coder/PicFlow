import type { PicFlowCase } from '../types';

export function formatModelTagsForCopy(work: PicFlowCase): string {
  return (work.modelTags ?? []).map((tag) => tag.trim()).filter(Boolean).join(', ');
}

export function formatWorkSummaryForCopy(work: PicFlowCase): string {
  const lines: string[] = [];
  const modelTags = formatModelTagsForCopy(work);

  if (modelTags) lines.push(`模型：${modelTags}`);
  if (work.prompt?.trim()) {
    if (lines.length) lines.push('');
    lines.push('Prompt：', work.prompt.trim());
  }
  lines.push('', `垫图：${work.referenceImages?.length ?? 0} 张`);
  if (work.sourceUrl?.trim()) lines.push(`来源：${work.sourceUrl.trim()}`);

  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n').trim();
}

