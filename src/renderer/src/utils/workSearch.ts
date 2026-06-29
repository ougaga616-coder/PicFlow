import type { PicFlowCase } from '../types';

export function matchesWorkSearch(work: PicFlowCase, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    work.title,
    work.prompt,
    work.sourceUrl,
    ...(work.modelTags ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
}

