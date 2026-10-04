import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
const directory = new URL("../packages/protocol/schemas/", import.meta.url);
const families = ["scenario", "config", "plan", "protocol", "trace", "result"];
let output = "// Generated from the normative JSON Schemas. Do not edit.\n";
const exported = new Set();
for (const family of families) {
  const schema = JSON.parse(
    await readFile(new URL(`${family}.schema.json`, directory), "utf8"),
  );
  const source = await compile(schema, schema.title, {
    cwd: fileURLToPath(directory),
    bannerComment: "",
    unreachableDefinitions: true,
    $refOptions: {
      resolve: {
        http: false,
        localSchema: {
          order: 1,
          canRead: /^https:\/\/causign\.dev\/schemas\//,
          read: async (file) =>
            readFile(new URL(file.url.split("/").at(-1), directory), "utf8"),
        },
      },
    },
  });
  const namespace = family[0].toUpperCase() + family.slice(1) + "Contracts";
  output += `\nexport namespace ${namespace} {\n${source.trim()}\n}\n`;
  const names = [
    schema.title,
    ...Object.values(schema.definitions ?? {})
      .map((value) => value.title)
      .filter(Boolean),
  ];
  for (const name of names)
    if (!exported.has(name)) {
      output += `export type ${name} = ${namespace}.${name};\n`;
      exported.add(name);
    }
}
const target = new URL(
  "../packages/protocol/src/generated.ts",
  import.meta.url,
);
if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8");
  // Git may check out text as CRLF on Windows. Compare contract content while
  // retaining every other difference, including meaningful whitespace.
  if (current.replaceAll("\r\n", "\n") !== output.replaceAll("\r\n", "\n")) {
    console.error("Generated contracts are stale. Run pnpm generate.");
    process.exitCode = 1;
  }
} else await writeFile(target, output);
