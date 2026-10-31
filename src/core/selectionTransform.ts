import type { Selection } from "../types";

export type SelectionTransformMode = "move" | "scale" | "rotate" | "free";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectionTransform {
  centerX: number;
  centerY: number;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export function identitySelectionTransform(box: Rect): SelectionTransform {
  return {
    centerX: box.x + box.w / 2,
    centerY: box.y + box.h / 2,
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

export function computeSelectionTransform(
  mode: SelectionTransformMode,
  box: Rect,
  start: Point,
  current: Point
): SelectionTransform {
  const transform = identitySelectionTransform(box);
  if (mode === "move") {
    return {
      ...transform,
      translateX: current.x - start.x,
      translateY: current.y - start.y,
    };
  }

  const startX = start.x - transform.centerX;
  const startY = start.y - transform.centerY;
  const currentX = current.x - transform.centerX;
  const currentY = current.y - transform.centerY;

  if (mode === "scale") {
    const startDistance = Math.max(1, Math.hypot(startX, startY));
    const currentDistance = Math.max(0.05, Math.hypot(currentX, currentY));
    const scale = clamp(currentDistance / startDistance, 0.05, 20);
    return { ...transform, scaleX: scale, scaleY: scale };
  }

  if (mode === "rotate") {
    const startAngle = Math.atan2(startY, startX);
    const currentAngle = Math.atan2(currentY, currentX);
    return { ...transform, rotation: currentAngle - startAngle };
  }

  return {
    ...transform,
    scaleX: signedScale(currentX, startX),
    scaleY: signedScale(currentY, startY),
  };
}

export function transformPoint(point: Point, transform: SelectionTransform): Point {
  const x = (point.x - transform.centerX) * transform.scaleX;
  const y = (point.y - transform.centerY) * transform.scaleY;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: transform.centerX + transform.translateX + x * cos - y * sin,
    y: transform.centerY + transform.translateY + x * sin + y * cos,
  };
}

export function transformedRectBounds(
  rect: Rect,
  transform: SelectionTransform
): Rect {
  const points = [
    transformPoint({ x: rect.x, y: rect.y }, transform),
    transformPoint({ x: rect.x + rect.w, y: rect.y }, transform),
    transformPoint({ x: rect.x + rect.w, y: rect.y + rect.h }, transform),
    transformPoint({ x: rect.x, y: rect.y + rect.h }, transform),
  ];
  return pointsBounds(points);
}

export function translateSelection(selection: Selection, dx: number, dy: number): Selection {
  if (selection.kind === "none") return selection;
  if (selection.kind === "rect") {
    return { ...selection, x: selection.x + dx, y: selection.y + dy };
  }
  if (selection.kind === "polygon") {
    return {
      ...selection,
      points: selection.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      x: selection.x + dx,
      y: selection.y + dy,
    };
  }
  return {
    ...selection,
    x: selection.x + dx,
    y: selection.y + dy,
  };
}

export function transformSelectionGeometry(
  selection: Selection,
  transform: SelectionTransform
): Selection {
  if (selection.kind === "none") return selection;
  if (selection.kind === "rect") {
    const bounds = transformedRectBounds(selection, transform);
    return { kind: "rect", ...bounds };
  }
  if (selection.kind === "polygon") {
    const points = selection.points.map((p) => transformPoint(p, transform));
    const bounds = pointsBounds(points);
    return { kind: "polygon", points, ...bounds };
  }
  const bounds = transformedRectBounds(selection, transform);
  return { ...selection, ...bounds };
}

function pointsBounds(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function signedScale(current: number, start: number): number {
  const denom = Math.abs(start) < 1 ? (start < 0 ? -1 : 1) : start;
  const raw = current / denom;
  if (Math.abs(raw) < 0.05) return raw < 0 ? -0.05 : 0.05;
  return clamp(raw, -20, 20);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
