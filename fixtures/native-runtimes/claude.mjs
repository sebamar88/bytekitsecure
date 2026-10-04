// Deterministic native CLI boundary fixture: no provider calls or credentials.
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("2.1.284 (Claude Code fixture)");
} else {
  if (process.env.CAUSIGN_NATIVE_MARKER)
    writeFileSync(process.env.CAUSIGN_NATIVE_MARKER, "executed");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (input === "malformed") console.log("not JSON");
  else if (input.startsWith("stall:")) {
    writeFileSync(input.slice(6), String(process.pid));
    setInterval(() => {}, 1000);
  } else if (input === "stall") {
    setInterval(() => {}, 1000);
  } else {
    console.log(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: input,
      }),
    );
    if (input === "nonzero") process.exitCode = 7;
  }
}
