import {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

// ===== Button =====
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
}
export function Button({ variant = "default", className = "", ...rest }: ButtonProps) {
  return <button className={`btn ${variant} ${className}`} {...rest} />;
}

// ===== IconButton =====
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  title?: string;
}
export function IconButton({
  active,
  className = "",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button className={`icon-btn ${active ? "active" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// ===== Slider =====
interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}
export function Slider({ label, value, min, max, step = 1, onChange, format }: SliderProps) {
  return (
    <div className="slider">
      {label && <span className="slider-label">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-val">{format ? format(value) : value}</span>
    </div>
  );
}

// ===== Tabs =====
interface TabsProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}
export function Tabs<T extends string>({ value, onChange, options }: TabsProps<T>) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button
          key={o.value}
          className={`tab ${value === o.value ? "active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ===== Popover =====
interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: { x: number; y: number };
  children: ReactNode;
  style?: CSSProperties;
}
export function Popover({ open, onClose, anchor, children, style }: PopoverProps) {
  if (!open) return null;
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div
        className="popover"
        style={{ left: anchor.x, top: anchor.y, ...style }}
      >
        {children}
      </div>
    </>
  );
}

// ===== Toast =====
export interface ToastItem {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

let toastListeners: ((t: ToastItem) => void)[] = [];
let toastId = 1;
export function pushToast(text: string, kind: ToastItem["kind"] = "info"): void {
  const item: ToastItem = { id: toastId++, kind, text };
  for (const l of toastListeners) l(item);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const listener = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 3500);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);
  return (
    <div className="toast-container">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ===== Tooltip (シンプルなtitle使用、軽量) =====
// titleで十分なので独自実装は省略。

// ===== ColorSwatch =====
interface ColorSwatchProps {
  color: string;
  onChange: (c: string) => void;
  size?: "default" | "large";
}
export function ColorSwatch({ color, onChange, size = "default" }: ColorSwatchProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className={`swatch ${size === "large" ? "swatch-large" : ""}`}
        style={{ background: color }}
        onClick={() => ref.current?.click()}
        title={color}
      />
      <input
        ref={ref}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        style={{ display: "none" }}
      />
    </>
  );
}
