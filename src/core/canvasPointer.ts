export interface CanvasPointerTransform {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  docWidth: number;
  docHeight: number;
  zoom: number;
  rotation: number;
  flipped: boolean;
}

export function canvasPointerToDocumentPoint({
  clientX,
  clientY,
  rectLeft,
  rectTop,
  rectWidth,
  rectHeight,
  canvasWidth,
  canvasHeight,
  docWidth,
  docHeight,
  zoom,
  rotation,
  flipped,
}: CanvasPointerTransform): { x: number; y: number } {
  const cx = rectLeft + rectWidth / 2;
  const cy = rectTop + rectHeight / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const rad = (-rotation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const unrotatedWidth = canvasWidth * zoom;
  const unrotatedHeight = canvasHeight * zoom;
  const unflippedX = rx + unrotatedWidth / 2;
  const localX = flipped ? unrotatedWidth - unflippedX : unflippedX;
  const localY = ry + unrotatedHeight / 2;

  return {
    x: (localX / unrotatedWidth) * docWidth,
    y: (localY / unrotatedHeight) * docHeight,
  };
}
