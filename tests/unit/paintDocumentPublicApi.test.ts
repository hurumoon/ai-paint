import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const testDir = dirname(fileURLToPath(import.meta.url));
const paintDocumentPath = resolve(testDir, "../../src/core/PaintDocument.ts");

const allowedPublicMethods = [
  "addGroup",
  "addLayer",
  "addTextLayer",
  "extendCanvas",
  "getActiveLayer",
  "getBgVersion",
  "getDescendantIds",
  "getLayer",
  "getSnapshot",
  "invalidate",
  "invalidateActive",
  "loadImageAsLayer",
  "materializeAllLayers",
  "materializeLayer",
  "materializeLayers",
  "mergeDown",
  "removeLayer",
  "reorderLayer",
  "replaceLayerObjects",
  "replaceLayers",
  "replaceLayersFromCanvas",
  "resetForNew",
  "resize",
  "setActiveLayer",
  "setBlendMode",
  "setClippingMask",
  "setDpi",
  "setGroupCollapsed",
  "setLayerParent",
  "setOpacity",
  "setTransparentPixelLock",
  "setVisibility",
  "subscribe",
  "updateLayerMeta",
  "updateTextLayer",
];

function hasPrivateModifier(node: ts.ClassElement): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) === true
  );
}

function memberName(node: ts.ClassElement): string | null {
  if (!("name" in node) || !node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

function publicMethodNames(): string[] {
  const sourceText = readFileSync(paintDocumentPath, "utf8");
  const sourceFile = ts.createSourceFile(
    paintDocumentPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== "PaintDocument") continue;
    for (const member of statement.members) {
      if (hasPrivateModifier(member)) continue;
      if (ts.isMethodDeclaration(member)) {
        const name = memberName(member);
        if (name) names.push(name);
      }
      if (
        ts.isPropertyDeclaration(member) &&
        member.initializer &&
        ts.isArrowFunction(member.initializer)
      ) {
        const name = memberName(member);
        if (name) names.push(name);
      }
    }
  }

  return names.sort();
}

describe("PaintDocument public API tripwire", () => {
  it("detects unreviewed additions to the public method surface", () => {
    expect(publicMethodNames()).toEqual([...allowedPublicMethods].sort());
  });
});
