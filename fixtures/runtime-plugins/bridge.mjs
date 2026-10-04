import { serveOutputBridge, readVerifiedCandidate } from "@causign/runtime";
const candidate = JSON.parse(process.argv[2]);
await serveOutputBridge({
  name: "example-framework",
  version: "1",
  async execute(input) {
    if (input === "error") throw Error("Fixture native failure");
    const definition = JSON.parse(await readVerifiedCandidate(candidate));
    return { text: definition.text };
  },
});
