// MUIなどを避けるため、必要なアイコンだけ自前SVGで持つ。lucideベースの簡略版。
import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const wrap = (path: JSX.Element, viewBox = "0 0 24 24") => (props: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {path}
  </svg>
);

export const IconBrush = wrap(
  <>
    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 014.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 00-3-3.02z" />
  </>
);

export const IconPenNib = wrap(
  <>
    <path d="M12 2l7 7-10 13-7-7L12 2z" />
    <path d="M12 2l1.5 7.5L21 11" />
    <circle cx="10" cy="14" r="1.5" />
  </>
);

export const IconSpray = wrap(
  <>
    <path d="M8 11h4l2 10H6l2-10z" />
    <path d="M9 7h2a2 2 0 012 2v2H7V9a2 2 0 012-2z" />
    <path d="M10 7V4h4" />
    <circle cx="17" cy="5" r="1" />
    <circle cx="20" cy="8" r="1" />
    <circle cx="18" cy="11" r="1" />
  </>
);

export const IconEraser = wrap(
  <>
    <path d="M20 20H9L4 15a2 2 0 010-3l9-9a2 2 0 013 0l7 7a2 2 0 010 3l-5 5" />
    <path d="M9 20l-4-4" />
  </>
);

export const IconBucket = wrap(
  <>
    <path d="M5 2L19 16L13 22L5 14V2z" />
    <path d="M5 2L13 10" />
    <circle cx="20" cy="12" r="2" />
  </>
);

export const IconSelect = wrap(
  <>
    <path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6" strokeDasharray="2 2" />
  </>
);

export const IconBlur = wrap(
  <>
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="7" strokeDasharray="2 3" />
    <circle cx="12" cy="12" r="10" strokeDasharray="1 3" />
  </>
);

export const IconGradient = wrap(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 21L21 3" />
  </>
);

export const IconShape = wrap(
  <>
    <rect x="3" y="3" width="10" height="10" rx="1" />
    <circle cx="17" cy="17" r="4" />
  </>
);

export const IconEyedropper = wrap(
  <>
    <path d="M2 22l3-1 11-11" />
    <path d="M13 8l3 3" />
    <path d="M16 5l3 3a2 2 0 010 3l-3 3-6-6 3-3a2 2 0 013 0z" />
  </>
);

export const IconMove = wrap(
  <>
    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
  </>
);

export const IconLayerPick = wrap(
  <>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M13 14l4 8 1.5-3 3-1.5-8.5-3.5z" />
  </>
);

export const IconHand = wrap(
  <>
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </>
);

export const IconUndo = wrap(<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7" />);
export const IconRedo = wrap(<path d="M21 7v6h-6M21 13a9 9 0 1 1-3-7" />);

export const IconPlus = wrap(<path d="M12 5v14M5 12h14" />);
export const IconTrash = wrap(
  <>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
  </>
);
export const IconArrowUp = wrap(<path d="M12 19V5M5 12l7-7 7 7" />);
export const IconArrowDown = wrap(<path d="M12 5v14M19 12l-7 7-7-7" />);
export const IconEye = wrap(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const IconEyeOff = wrap(
  <>
    <path d="M2 2l20 20" />
    <path d="M6.7 6.7C4.18 8.32 2 12 2 12s3.5 7 10 7c2 0 3.74-.65 5.18-1.55" />
    <path d="M9.9 4.24A11 11 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-3.16 3.84" />
    <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
  </>
);
export const IconMerge = wrap(
  <>
    <path d="M12 3v8M8 7l4-4 4 4" />
    <path d="M5 21h14" />
  </>
);

export const IconSun = wrap(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </>
);
export const IconMoon = wrap(
  <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
);

export const IconRotate = wrap(
  <>
    <path d="M3 12a9 9 0 0 1 14.6-7" />
    <path d="M21 4v6h-6" />
  </>
);
export const IconRotateCCW = wrap(
  <>
    <path d="M21 12a9 9 0 0 0-14.6-7" />
    <path d="M3 4v6h6" />
  </>
);
export const IconFlipHorizontal = wrap(
  <>
    <path d="M12 3v18" />
    <path d="M8 7H3l3-3" />
    <path d="M3 7l3 3" />
    <path d="M16 7h5l-3-3" />
    <path d="M21 7l-3 3" />
    <path d="M8 17H3l3-3" />
    <path d="M3 17l3 3" />
    <path d="M16 17h5l-3-3" />
    <path d="M21 17l-3 3" />
  </>
);
export const IconClock = wrap(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);
export const IconCamera = wrap(
  <>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </>
);
export const IconImage = wrap(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </>
);
export const IconBookOpen = wrap(
  <>
    <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H11v18H4.5A2.5 2.5 0 0 1 2 18.5z" />
    <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H13v18h6.5a2.5 2.5 0 0 0 2.5-2.5z" />
    <path d="M6 8h2M16 8h2M6 12h2M16 12h2" />
  </>
);
export const IconZoom = wrap(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
    <path d="M8 11h6M11 8v6" />
  </>
);
export const IconSparkles = wrap(
  <>
    <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" />
    <path d="M19 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
  </>
);
export const IconDownload = wrap(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </>
);
export const IconFilm = wrap(
  <>
    <rect x="2" y="2" width="20" height="20" rx="2" />
    <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5" />
  </>
);
export const IconCompare = wrap(
  <>
    <path d="M12 3v18" />
    <path d="M8 7l-4 4 4 4" />
    <path d="M16 17l4-4-4-4" />
  </>
);
export const IconCanvas = wrap(
  <>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeDasharray="2 4" opacity="0.5" />
  </>
);

export const IconCanvasExpand = wrap(
  <>
    <rect x="7" y="7" width="10" height="10" rx="1" />
    <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
    <path d="M8 8L3 3M16 8l5-5M8 16l-5 5M16 16l5 5" />
  </>
);

export const IconText = wrap(
  <>
    <path d="M4 7V5h16v2" />
    <path d="M9 5v14M15 19h-6" />
  </>
);

export const IconKeyboard = wrap(
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </>
);

export const IconGrid = wrap(
  <>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </>
);

export const IconUpload = wrap(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5" />
    <path d="M12 3v12" />
  </>
);

export const IconNew = wrap(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M12 12v6" />
    <path d="M9 15h6" />
  </>
);

export const IconPolygon = wrap(
  <path d="M12 2l10 7-4 12H6L2 9z" />
);

export const IconWand = wrap(
  <>
    <path d="M15 4v4M19 6h-4M19 16v4M21 18h-4" />
    <path d="M11 8l-7 7 3 3 7-7-3-3z" />
  </>
);

export const IconSliders = wrap(
  <>
    <path d="M3 6h13M19 6h2M3 12h7M13 12h8M3 18h17M21 18h-2" />
    <circle cx="17" cy="6" r="2" />
    <circle cx="11" cy="12" r="2" />
    <circle cx="20" cy="18" r="2" />
  </>
);

export const IconLayout = wrap(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </>
);

export const IconChat = wrap(
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
);

export const IconExternalLink = wrap(
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </>
);

export const IconSend = wrap(
  <>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </>
);

export const IconFolder = wrap(
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
);

export const IconFolderOpen = wrap(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2" />
    <path d="M3 9h18l-2 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
  </>
);

export const IconChevronRight = wrap(<path d="M9 6l6 6-6 6" />);
export const IconChevronDown = wrap(<path d="M6 9l6 6 6-6" />);

export const IconIndentIn = wrap(
  <>
    <path d="M4 7h8M4 12h12M4 17h8" />
    <path d="M16 7l4 5-4 5" />
  </>
);

export const IconIndentOut = wrap(
  <>
    <path d="M12 7h8M8 12h12M12 17h8" />
    <path d="M8 7l-4 5 4 5" />
  </>
);

export const IconSave = wrap(
  <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </>
);

// クリッピングマスク: 「下のレイヤーへクリップ」を示す下向き矢印（折れ線）
export const IconClip = wrap(
  <>
    <path d="M8 3v10a4 4 0 0 0 4 4h4" />
    <path d="M13 14l3 3-3 3" />
  </>
);

export const IconTransparentLock = wrap(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 4v6M15 4v6" opacity="0.55" />
    <path d="M9 15h6" />
    <rect x="7" y="12" width="10" height="7" rx="1" />
    <path d="M9 12v-1a3 3 0 0 1 6 0v1" />
  </>
);

export const IconSettings = wrap(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
);

export const IconInfo = wrap(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </>
);
