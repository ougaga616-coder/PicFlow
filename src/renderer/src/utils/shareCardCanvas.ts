export type ShareCardRenderData = {
  mainImageSrc: string;
  referenceImageSrcs: string[];
  prompt: string;
  modelTags: string[];
};

const cardWidth = 1080;
const cardHeight = 1440;
const cardPadding = 64;
const imageRadius = 34;

type Point = {
  x: number;
  y: number;
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawContainedImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, radius: number, background = '#eef1ec'): void {
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.clip();

  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, text: string): void {
  ctx.save();
  roundedRect(ctx, x, y, width, height, imageRadius);
  ctx.fillStyle = '#eef1ec';
  ctx.fill();
  ctx.strokeStyle = '#d8ddd7';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#8a968d';
  ctx.font = '500 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + width / 2, y + height / 2);
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (lines.length < maxLines) lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(nextLine).width <= maxWidth) {
        line = nextLine;
        continue;
      }

      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length >= maxLines) break;
  }

  if (lines.length === maxLines && ctx.measureText(lines[maxLines - 1]).width > 0) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '') || lines[maxLines - 1]}...`;
  }
  return lines.slice(0, maxLines);
}

function drawTags(ctx: CanvasRenderingContext2D, tags: string[], start: Point, maxWidth: number): number {
  let x = start.x;
  let y = start.y;
  const tagHeight = 48;
  const gap = 12;

  ctx.font = '500 24px sans-serif';
  for (const tag of tags) {
    const text = tag.trim() || '未标注模型';
    const width = Math.min(ctx.measureText(text).width + 32, maxWidth);
    if (x + width > start.x + maxWidth) {
      x = start.x;
      y += tagHeight + gap;
    }

    roundedRect(ctx, x, y, width, tagHeight, 18);
    ctx.fillStyle = '#eef1ec';
    ctx.fill();
    ctx.fillStyle = '#536257';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 16, y + tagHeight / 2, width - 32);
    x += width + gap;
  }

  return y + tagHeight;
}

export async function renderShareCardToCanvas(canvas: HTMLCanvasElement, data: ShareCardRenderData): Promise<void> {
  canvas.width = cardWidth;
  canvas.height = cardHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.fillStyle = '#f7f8f4';
  ctx.fillRect(0, 0, cardWidth, cardHeight);

  ctx.fillStyle = '#dfe6df';
  ctx.beginPath();
  ctx.arc(910, 120, 170, 0, Math.PI * 2);
  ctx.fill();

  const mainImage = await loadImage(data.mainImageSrc);
  const mainRect = { x: cardPadding, y: 64, width: cardWidth - cardPadding * 2, height: 650 };
  if (mainImage) drawContainedImage(ctx, mainImage, mainRect.x, mainRect.y, mainRect.width, mainRect.height, imageRadius);
  else drawPlaceholder(ctx, mainRect.x, mainRect.y, mainRect.width, mainRect.height, '主图暂不可用');

  let cursorY = mainRect.y + mainRect.height + 34;
  const referenceImages = (await Promise.all(data.referenceImageSrcs.slice(0, 6).map(loadImage))).filter(Boolean) as HTMLImageElement[];
  if (referenceImages.length) {
    ctx.fillStyle = '#68746b';
    ctx.font = '600 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('垫图', cardPadding, cursorY);
    cursorY += 38;

    const thumbSize = 116;
    const gap = 14;
    referenceImages.forEach((image, index) => {
      const x = cardPadding + index * (thumbSize + gap);
      drawContainedImage(ctx, image, x, cursorY, thumbSize, thumbSize, 22, '#ffffff');
    });
    cursorY += thumbSize + 40;
  }

  ctx.fillStyle = '#303830';
  ctx.font = '700 30px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Prompt', cardPadding, cursorY);
  cursorY += 44;

  const prompt = data.prompt.trim() || '暂无 Prompt';
  ctx.fillStyle = '#4b554e';
  ctx.font = '400 30px sans-serif';
  const promptLines = wrapText(ctx, prompt, cardWidth - cardPadding * 2, 10);
  const lineHeight = 43;
  promptLines.forEach((line, index) => {
    ctx.fillText(line, cardPadding, cursorY + index * lineHeight);
  });

  const footerY = cardHeight - 184;
  const tags = data.modelTags.filter((tag) => tag.trim()) ;
  drawTags(ctx, tags.length ? tags : ['未标注模型'], { x: cardPadding, y: footerY }, 650);

  ctx.fillStyle = '#7a837c';
  ctx.font = '600 28px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('PicFlow / by OMG Design Lab', cardWidth - cardPadding, cardHeight - 78);
}

export function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}
