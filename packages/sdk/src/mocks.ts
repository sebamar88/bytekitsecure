import {
  validateJsonValue,
  type JsonValue,
  type ToolMock,
} from "@causign/protocol";
export type MockInput =
  | ToolMock[]
  | Record<
      string,
      | { result: JsonValue; error?: never }
      | { error: JsonValue; result?: never }
    >;
export function normalizeMocks(input: MockInput = []): ToolMock[] {
  validateJsonValue(input);
  const mocks: Array<ToolMock> = Array.isArray(input)
    ? structuredClone(input)
    : Object.entries(input).map(([name, response]) => {
        const keys = Object.keys(response);
        if (keys.length !== 1 || !["result", "error"].includes(keys[0]))
          throw new Error("Mock requires exactly one result or error");
        const kind = keys[0] as "result" | "error";
        return {
          type: "tool",
          name,
          response: {
            kind,
            value: structuredClone(response[kind]) as JsonValue,
          },
        };
      });
  const names = new Set<string>();
  for (const mock of mocks) {
    if (names.has(mock.name))
      throw new Error(`Duplicate mock name: ${mock.name}`);
    names.add(mock.name);
  }
  return mocks;
}
