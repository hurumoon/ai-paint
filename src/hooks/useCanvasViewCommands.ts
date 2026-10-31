import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export const DEFAULT_ROTATION_STEP = 90;

export function normalizeRotationDegrees(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

interface UseCanvasViewCommandsOptions {
  setRotation: Dispatch<SetStateAction<number>>;
  setCanvasFlipped: Dispatch<SetStateAction<boolean>>;
}

export function useCanvasViewCommands({
  setRotation,
  setCanvasFlipped,
}: UseCanvasViewCommandsOptions) {
  const [rotationStep, setRotationStep] = useState(DEFAULT_ROTATION_STEP);

  const rotateViewClockwise = useCallback(() => {
    setRotation((r) => normalizeRotationDegrees(r + rotationStep));
  }, [rotationStep, setRotation]);

  const rotateViewCounterClockwise = useCallback(() => {
    setRotation((r) => normalizeRotationDegrees(r - rotationStep));
  }, [rotationStep, setRotation]);

  const toggleHorizontalFlip = useCallback(() => {
    setCanvasFlipped((v) => !v);
  }, [setCanvasFlipped]);

  return {
    rotationStep,
    setRotationStep,
    rotateViewClockwise,
    rotateViewCounterClockwise,
    toggleHorizontalFlip,
  };
}

export type CanvasViewCommands = ReturnType<typeof useCanvasViewCommands>;
