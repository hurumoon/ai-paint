export function safeGetStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`localStorage read failed (${key}):`, error);
    return null;
  }
}

export function safeSetStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`localStorage write failed (${key}):`, error);
    return false;
  }
}

export function safeRemoveStorageItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`localStorage remove failed (${key}):`, error);
    return false;
  }
}
