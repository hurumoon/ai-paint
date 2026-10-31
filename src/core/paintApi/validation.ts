import type { JsonSchema } from "./types";

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  path = "$"
): ValidationIssue[] {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.filter(isSchema);
    if (branches.some((branch) => validateJsonSchema(value, branch, path).length === 0)) return [];
    return [{ path, message: "anyOf のいずれにも一致しません" }];
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.filter(isSchema);
    const matches = branches.filter(
      (branch) => validateJsonSchema(value, branch, path).length === 0
    ).length;
    return matches === 1 ? [] : [{ path, message: "oneOf の一致数が1ではありません" }];
  }

  const type = schema.type;
  if (type === "object") return validateObject(value, schema, path);
  if (type === "array") return validateArray(value, schema, path);
  if (type === "number" || type === "integer") return validateNumber(value, schema, path, type);
  if (type === "string") return validateString(value, schema, path);
  if (type === "boolean" && typeof value !== "boolean") {
    return [{ path, message: "boolean が必要です" }];
  }
  if (type === "null" && value !== null) return [{ path, message: "null が必要です" }];
  return validateEnum(value, schema, path);
}

function validateObject(value: unknown, schema: JsonSchema, path: string): ValidationIssue[] {
  if (!isRecord(value)) return [{ path, message: "object が必要です" }];
  const issues: ValidationIssue[] = [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  for (const key of required) {
    if (!(key in value)) issues.push({ path: `${path}.${key}`, message: "必須です" });
  }
  for (const [key, childValue] of Object.entries(value)) {
    const childSchema = properties[key];
    if (isSchema(childSchema)) {
      issues.push(...validateJsonSchema(childValue, childSchema, `${path}.${key}`));
    } else if (schema.additionalProperties === false) {
      issues.push({ path: `${path}.${key}`, message: "未定義のプロパティです" });
    }
  }
  return issues;
}

function validateArray(value: unknown, schema: JsonSchema, path: string): ValidationIssue[] {
  if (!Array.isArray(value)) return [{ path, message: "array が必要です" }];
  const issues: ValidationIssue[] = [];
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    issues.push({ path, message: `${schema.minItems}件以上が必要です` });
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    issues.push({ path, message: `${schema.maxItems}件以下にしてください` });
  }
  if (isSchema(schema.items)) {
    value.forEach((entry, index) => {
      issues.push(...validateJsonSchema(entry, schema.items as JsonSchema, `${path}[${index}]`));
    });
  }
  return issues;
}

function validateNumber(
  value: unknown,
  schema: JsonSchema,
  path: string,
  type: "number" | "integer"
): ValidationIssue[] {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [{ path, message: "有限な数値が必要です" }];
  }
  if (type === "integer" && !Number.isInteger(value)) {
    return [{ path, message: "整数が必要です" }];
  }
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    return [{ path, message: `${schema.minimum}以上が必要です` }];
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    return [{ path, message: `${schema.maximum}以下にしてください` }];
  }
  return validateEnum(value, schema, path);
}

function validateString(value: unknown, schema: JsonSchema, path: string): ValidationIssue[] {
  if (typeof value !== "string") return [{ path, message: "string が必要です" }];
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    return [{ path, message: `${schema.minLength}文字以上が必要です` }];
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    return [{ path, message: `${schema.maxLength}文字以下にしてください` }];
  }
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
    return [{ path, message: "形式が正しくありません" }];
  }
  return validateEnum(value, schema, path);
}

function validateEnum(value: unknown, schema: JsonSchema, path: string): ValidationIssue[] {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
    return [{ path, message: `許可値: ${schema.enum.join(", ")}` }];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is JsonSchema {
  return isRecord(value);
}
