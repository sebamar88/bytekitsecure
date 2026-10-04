#!/usr/bin/env node
import { main } from "./main.js";
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
try {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
    signal: controller.signal,
  });
} finally {
  process.removeListener("SIGINT", interrupt);
}
