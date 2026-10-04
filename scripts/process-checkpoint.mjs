import { openProcess } from "../packages/core/dist/index.js";
import { ProtocolSession } from "../packages/protocol/dist/index.js";
import { checkpoint } from "../fixtures/checkpoint-harness.mjs";
const { events: _events, ...summary } = await checkpoint(
  openProcess,
  ProtocolSession,
);
console.log(JSON.stringify(summary, null, 2));
