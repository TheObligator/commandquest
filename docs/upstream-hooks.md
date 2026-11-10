# Upstream hooks

Every change we make to an upstream Forge file (anything outside `forge-web-server/`, `web/`,
`overrides/`, `docs/`, `.github/workflows/`) is listed here. Each one is marked in the source with
a `WEB-HOOK: <reason>` comment. Keep this list short — each entry is a potential merge conflict.

| File | Line | Reason |
|---|---|---|

_None yet._ Our server is built through `forge-web-server/reactor.xml` instead of being added to the
root `pom.xml`, so upstream's build files stay untouched.
