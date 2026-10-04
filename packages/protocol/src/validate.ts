import { readFileSync } from "node:fs";
import AjvModule, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import type {
  ProtocolMessage,
  ScenarioDefinition,
  RunPlan,
  Trace,
  ScenarioResult,
  CausignConfig,
  JsonValue,
} from "./generated.js";
const Ajv = AjvModule as unknown as typeof AjvModule.default;
const addFormats =
  addFormatsModule as unknown as typeof addFormatsModule.default;
const ajv = new Ajv({ allErrors: true, strict: true, strictNumbers: true });
addFormats(ajv);
const families = [
  "scenario",
  "config",
  "plan",
  "protocol",
  "trace",
  "result",
] as const;
for (const family of families) {
  const schema = JSON.parse(
    readFileSync(
      new URL(`../schemas/${family}.schema.json`, import.meta.url),
      "utf8",
    ),
  );
  ajv.addSchema(schema);
}
export class ContractError extends Error {
  readonly schemaPath: string;
  readonly instancePath: string;
  readonly errors: readonly ErrorObject[];
  constructor(
    message: string,
    schemaPath: string,
    instancePath = "",
    errors: readonly ErrorObject[] = [],
  ) {
    super(message);
    this.name = "ContractError";
    this.schemaPath = schemaPath;
    this.instancePath = instancePath;
    this.errors = errors;
  }
}
// JSON Schema validates JSON data. Reject JavaScript values which cannot cross
// that boundary without coercion or silently losing information first.
function assertJson(
  value: unknown,
  path = "",
  ancestors = new Set<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object")
    throw new ContractError("Value is not JSON", "#/json", path);
  if (ancestors.has(value))
    throw new ContractError("Cyclic value is not JSON", "#/json", path);
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new ContractError(
      "Only plain JSON objects are supported",
      "#/json",
      path,
    );
  if (Object.getOwnPropertySymbols(value).length)
    throw new ContractError("Symbol keys are not JSON", "#/json", path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const key of Object.keys(descriptors)) {
      if (key === "length") continue;
      const index = Number(key);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== key
      )
        throw new ContractError(
          "Custom array properties are not JSON",
          "#/json",
          `${path}/${key}`,
        );
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor)
        throw new ContractError(
          "Sparse arrays are not JSON",
          "#/json",
          `${path}/${index}`,
        );
    }
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    const entryPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (!("value" in descriptor))
      throw new ContractError(
        "Accessors are not JSON data",
        "#/json",
        entryPath,
      );
    if (!descriptor.enumerable)
      throw new ContractError(
        "Hidden properties are not JSON data",
        "#/json",
        entryPath,
      );
    assertJson(descriptor.value, entryPath, ancestors);
  }
  ancestors.delete(value);
}
/** Validate the JavaScript-to-JSON boundary without reading accessors or coercing values. */
export function validateJsonValue(value: unknown): JsonValue {
  assertJson(value);
  return value as JsonValue;
}
function validator<T>(
  family: (typeof families)[number],
): (value: unknown) => T {
  const validate = ajv.getSchema(
    `https://causign.dev/schemas/${family}.schema.json`,
  ) as ValidateFunction<T>;
  return (value) => {
    assertJson(value);
    if (!validate(value)) {
      const errors = structuredClone(validate.errors ?? []);
      const first = errors[0];
      throw new ContractError(
        `${family} contract violation at ${first?.instancePath || "/"}: ${first?.message ?? "invalid data"}`,
        first?.schemaPath ?? "#",
        first?.instancePath ?? "",
        errors,
      );
    }
    return value;
  };
}
export const validateMessage = validator<ProtocolMessage>("protocol");
export const validateScenario = validator<ScenarioDefinition>("scenario");
export const validatePlan = validator<RunPlan>("plan");
export const validateTrace = validator<Trace>("trace");
export const validateResult = validator<ScenarioResult>("result");
export const validateConfig = validator<CausignConfig>("config");

/** Validate the complete JSON collection before accessing any scenario identifiers. */
export function validateScenarioCollection(
  definitions: ScenarioDefinition[],
): void {
  validateJsonValue(definitions);
  if (!Array.isArray(definitions))
    throw new ContractError("Scenario collection must be an array", "#/json");
  for (const definition of definitions) validateScenario(definition);
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id))
      throw new Error(`Duplicate scenario ID: ${definition.id}`);
    ids.add(definition.id);
  }
}
