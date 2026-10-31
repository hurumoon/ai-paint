declare const __APP_GIT_HASH__: string;
declare const __APP_GIT_HASH_FULL__: string;

interface Window {
  __AI_PAINT_STARTUP_SPLASH__?: {
    label: string;
    percent: number;
  };
  __AI_PAINT_SET_STARTUP_SPLASH__?: (label: string, percent: number) => void;
}
