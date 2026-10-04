# Causign documentation

Coming from the earlier MVP? Read [Migrating to Causign](migration-to-causign.md).

| Goal                                                       | Guide                                             |
| ---------------------------------------------------------- | ------------------------------------------------- |
| Run a harmless first test                                  | [Getting started](getting-started.md)             |
| Write mocks, assertions and evaluations                    | [Scenarios](scenarios.md)                         |
| Connect JavaScript, Python or Vercel AI SDK                | [Adapters](adapters.md)                           |
| Discover agents and extend framework support (development) | [Agent discovery and plugins](agent-discovery.md) |
| Explain failures and security claims                       | [Results and security](results-and-security.md)   |
| Inspect failures in a local browser                        | [Local reports](local-reports.md)                 |
| Test in GitHub Actions                                     | [CI](ci.md)                                       |
| Publish changed versions automatically                     | [npm publishing](npm-publishing.md)               |
| Contribute, measure coverage or pack distributions         | [Development](development.md)                     |
| Implement the wire contract                                | [Protocol v1](protocol-v1.md)                     |
| Verify adapter guarantees                                  | [Adapter conformance](adapter-conformance.md)     |

The [six JSON schemas](../packages/protocol/schemas) are authoritative for
structure; protocol documentation defines lifecycle semantics. Historical
specifications and plans under `superpowers/` are not installation instructions.
See the [example catalogue](../examples/README.md), [CLI reference](../packages/cli/README.md)
and [Vercel compatibility reference](../packages/adapter-vercel/README.md).
