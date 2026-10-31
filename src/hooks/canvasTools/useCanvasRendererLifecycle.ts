import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import { CanvasRenderer } from "../../core/CanvasRenderer";
import type { PaintDocument } from "../../core/PaintDocument";

interface UseCanvasRendererLifecycleParams {
  doc: PaintDocument;
  version: number;
  compositeRef: RefObject<HTMLCanvasElement>;
  overlayRef: RefObject<HTMLCanvasElement>;
  inputRef: RefObject<HTMLCanvasElement>;
  previewRef: RefObject<HTMLCanvasElement>;
}

export function useCanvasRendererLifecycle({
  doc,
  version,
  compositeRef,
  overlayRef,
  inputRef,
  previewRef,
}: UseCanvasRendererLifecycleParams): MutableRefObject<CanvasRenderer | null> {
  const rendererRef = useRef<CanvasRenderer | null>(null);

  useLayoutEffect(() => {
    if (!compositeRef.current) return;
    const renderer = new CanvasRenderer(compositeRef.current, doc);
    rendererRef.current = renderer;
    // タブ切替で同じ寸法・同じ version の doc に戻った場合でも、既存 canvas を必ず描き直す。
    renderer.invalidate();
    return () => renderer.dispose();
  }, [compositeRef, doc]);

  useEffect(() => {
    rendererRef.current?.invalidate();
  }, [version]);

  useEffect(() => {
    const { width, height } = doc;
    for (const el of [
      compositeRef.current,
      overlayRef.current,
      inputRef.current,
      previewRef.current,
    ]) {
      if (el && (el.width !== width || el.height !== height)) {
        el.width = width;
        el.height = height;
      }
    }
    rendererRef.current?.resize();
  }, [compositeRef, doc, doc.width, doc.height, inputRef, overlayRef, previewRef, version]);

  return rendererRef;
}
