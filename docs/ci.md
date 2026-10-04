# Continuous integration

## Consumer application

Install CLI/SDK through your distribution, commit the lockfile, and add:

```json
{ "scripts": { "test:agents": "causign run --output-dir .causign/results" } }
```

```yaml
name: Agent tests
on: [push, pull_request]
jobs:
  agents:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.25.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24.21.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:agents
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: causign-results
          path: .causign/results/
          include-hidden-files: true
          if-no-files-found: ignore
```

Tarball consumers must supply archives at their dependency paths before install;
this example does not assume npm publication. Add application build before tests
when required. Python agents need their runtime installed. Repository fixtures
use `CAUSIGN_PYTHON` from `setup-python`'s executable output.

Preserve exit codes: do not use `continue-on-error` or mask failures. Upload
evidence even on failure. Deterministic fixtures need no provider credentials;
live scenarios require explicit provider environment configuration.

## Repository release acceptance

The [actual workflow](../.github/workflows/ci.yml) covers:

| Runner             | Architecture |
| ------------------ | ------------ |
| `ubuntu-latest`    | x64          |
| `windows-latest`   | x64          |
| `macos-15`         | ARM64        |
| `ubuntu-24.04-arm` | ARM64        |

Each job verifies Node architecture and runs frozen install, generated contracts,
lint, typecheck, build, coverage and packed acceptance, with separate artifacts.

Packed acceptance builds five tarballs and a fresh consumer. It resolves a
lockfile and fetches dependencies online, then installs offline with the frozen
lockfile. Seven installed-CLI scenarios cover five domains, Python and deterministic
Vercel integration. No publication occurs. Green jobs verify that commit on
those runners, not arbitrary providers/frameworks or every OS version.
