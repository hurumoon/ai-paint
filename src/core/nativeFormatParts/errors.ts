export class AiPaintFileError extends Error {}

export function fail(message: string): never {
  throw new AiPaintFileError(message);
}

export function formatMegabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}
