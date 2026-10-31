import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReferenceImage } from "../../components/AIPanel";
import { imageFileToBase64ForAI } from "../../core/aiImagePayload";
import { AIImageMediaType } from "../../types";

const MAX_REFERENCE_IMAGES = 3;
const MAX_REFERENCE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_PIXELS = 4096 * 4096;
const SUPPORTED_REFERENCE_MEDIA_TYPES = new Set<AIImageMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

interface UseAIReferencesOptions {
  setError: (message: string) => void;
}

export type AIReferenceAddResult =
  | { ok: true; value: ReferenceImage }
  | { ok: false; error: string };

function normalizeReferenceMediaType(
  mediaType: string | undefined
): AIImageMediaType | null {
  if (!mediaType) return null;
  const normalized = mediaType.toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "image/jpeg";
  }
  return SUPPORTED_REFERENCE_MEDIA_TYPES.has(normalized as AIImageMediaType)
    ? (normalized as AIImageMediaType)
    : null;
}

function createReferenceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `ref-${crypto.randomUUID()}`
    : `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAIReferences({ setError }: UseAIReferencesOptions) {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [pendingReferenceCount, setPendingReferenceCount] = useState(0);
  const pendingReferenceCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const pendingReferencePreviewUrlsRef = useRef<Set<string>>(new Set());
  const referencePreviewUrlsRef = useRef<Map<string, string>>(new Map());

  const canAddReference =
    references.length + pendingReferenceCount < MAX_REFERENCE_IMAGES;

  useEffect(() => {
    const pendingReferencePreviewUrls = pendingReferencePreviewUrlsRef.current;
    const referencePreviewUrls = referencePreviewUrlsRef.current;
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const previewUrl of pendingReferencePreviewUrls) {
        URL.revokeObjectURL(previewUrl);
      }
      pendingReferencePreviewUrls.clear();
      for (const previewUrl of referencePreviewUrls.values()) {
        URL.revokeObjectURL(previewUrl);
      }
      referencePreviewUrls.clear();
    };
  }, []);

  const changePendingReferenceCount = useCallback((delta: number) => {
    const next = Math.max(
      0,
      Math.min(MAX_REFERENCE_IMAGES, pendingReferenceCountRef.current + delta)
    );
    pendingReferenceCountRef.current = next;
    setPendingReferenceCount(next);
  }, []);

  const releasePendingReference = useCallback(() => {
    changePendingReferenceCount(-1);
  }, [changePendingReferenceCount]);

  const handleAddReference = useCallback(async (file: File): Promise<AIReferenceAddResult> => {
    if (
      references.length + pendingReferenceCountRef.current >=
      MAX_REFERENCE_IMAGES
    ) {
      const error = `リファレンス画像は最大${MAX_REFERENCE_IMAGES}枚までです`;
      setError(error);
      return { ok: false, error };
    }
    if (file.size > MAX_REFERENCE_FILE_BYTES) {
      const error = "リファレンス画像が大きすぎます";
      setError(error);
      return { ok: false, error };
    }
    const mediaType = normalizeReferenceMediaType(file.type);
    if (!mediaType) {
      const error = "リファレンス画像は PNG / JPEG / WebP / GIF のみ対応しています";
      setError(error);
      return { ok: false, error };
    }
    changePendingReferenceCount(1);
    const previewUrl = URL.createObjectURL(file);
    pendingReferencePreviewUrlsRef.current.add(previewUrl);
    try {
      const payload = await imageFileToBase64ForAI(
        file,
        undefined,
        MAX_REFERENCE_PIXELS
      );
      if (!isMountedRef.current) {
        pendingReferencePreviewUrlsRef.current.delete(previewUrl);
        URL.revokeObjectURL(previewUrl);
        return { ok: false, error: "画面が閉じられたため、リファレンス画像の追加を中止しました" };
      }
      const id = createReferenceId();
      const reference: ReferenceImage = {
        id,
        base64: payload.base64,
        mediaType: "image/png",
        name: file.name,
        previewUrl,
      };
      pendingReferencePreviewUrlsRef.current.delete(previewUrl);
      referencePreviewUrlsRef.current.set(id, previewUrl);
      // APIの完了後、次の呼び出しから追加済み画像を参照できるようにする。
      flushSync(() => {
        setReferences((prev) => [...prev, reference]);
        releasePendingReference();
        setError("");
      });
      return { ok: true, value: reference };
    } catch (e) {
      pendingReferencePreviewUrlsRef.current.delete(previewUrl);
      URL.revokeObjectURL(previewUrl);
      const message = e instanceof Error ? e.message : String(e);
      const error =
        message === "リファレンス画像の解像度が大きすぎます"
          ? message
          : `リファレンス画像の変換に失敗しました: ${message}`;
      if (isMountedRef.current) {
        releasePendingReference();
        setError(error);
      }
      return { ok: false, error };
    }
  }, [
    changePendingReferenceCount,
    references.length,
    releasePendingReference,
    setError,
  ]);

  const handleRemoveReference = useCallback((id: string) => {
    const previewUrl = referencePreviewUrlsRef.current.get(id);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      referencePreviewUrlsRef.current.delete(id);
    }
    setReferences((prev) => {
      if (!prev.some((r) => r.id === id)) return prev;
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  return {
    references,
    canAddReference,
    handleAddReference,
    handleRemoveReference,
  };
}
