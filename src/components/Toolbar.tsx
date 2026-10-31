import { BrushCategory, Tool } from "../types";
import { BRUSH_CATEGORIES } from "../core/brushCategories";
import { IconButton } from "../ui/primitives";
import {
  IconBlur,
  IconBrush,
  IconBucket,
  IconEraser,
  IconEyedropper,
  IconGradient,
  IconLayerPick,
  IconMove,
  IconPenNib,
  IconSelect,
  IconShape,
  IconSparkles,
  IconSpray,
  IconText,
} from "../ui/Icons";

interface Props {
  tool: Tool;
  brushCategory: BrushCategory;
  onToolClick: (t: Tool) => void;
  onBrushCategoryClick: (c: BrushCategory) => void;
}

const BRUSH_CATEGORY_ICONS: Record<BrushCategory, typeof IconBrush> = {
  pen: IconPenNib,
  paint: IconBrush,
  spray: IconSpray,
  other: IconSparkles,
};

const TOOLS: { id: Tool; label: string; Icon: typeof IconBrush }[] = [
  { id: "eraser", label: "消しゴム", Icon: IconEraser },
  { id: "bucket", label: "バケツ", Icon: IconBucket },
  { id: "eyedropper", label: "スポイト", Icon: IconEyedropper },
  { id: "select", label: "範囲指定", Icon: IconSelect },
  { id: "blur", label: "ぼかし", Icon: IconBlur },
  { id: "gradient", label: "グラデーション", Icon: IconGradient },
  { id: "shape", label: "図形", Icon: IconShape },
  { id: "text", label: "テキスト", Icon: IconText },
  { id: "move", label: "移動", Icon: IconMove },
  { id: "layerPick", label: "レイヤー選択", Icon: IconLayerPick },
];

export function Toolbar({
  tool,
  brushCategory,
  onToolClick,
  onBrushCategoryClick,
}: Props) {
  return (
    <div className="toolbar">
      {BRUSH_CATEGORIES.map(({ value, label }) => {
        const Icon = BRUSH_CATEGORY_ICONS[value];
        return (
          <IconButton
            key={value}
            active={tool === "brush" && brushCategory === value}
            onClick={() => onBrushCategoryClick(value)}
            title={label}
          >
            <Icon />
          </IconButton>
        );
      })}
      {TOOLS.map(({ id, label, Icon }) => (
        <IconButton
          key={id}
          active={tool === id}
          onClick={() => onToolClick(id)}
          title={label}
        >
          <Icon />
        </IconButton>
      ))}
    </div>
  );
}
