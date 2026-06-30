import type { PicFlowCase, PicFlowImage } from '../types';

export function coverImage(work: PicFlowCase): PicFlowImage | undefined {
  return work.images.find((image) => image.id === work.coverImageId) ?? work.images[0];
}
