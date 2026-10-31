export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }

  if (error instanceof Error) {
    return /quota|storage|容量|disk|no space/i.test(error.message);
  }

  return false;
}

export function storageErrorDetail(error: unknown): string {
  if (error instanceof DOMException) {
    return error.message || error.name;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function formatStorageWriteError(
  error: unknown,
  fallback: string
): string {
  if (!isQuotaExceededError(error)) {
    return fallback;
  }

  return "ストレージ容量が足りないため保存できませんでした。不要なバックアップや参照画像を削除するか、別の保存先を選んでください。";
}
