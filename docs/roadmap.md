# Roadmap

- Consider auto-enabling `globals` mode when the build would hit TypeScript 58658 scenarios, with `--mode none` as an explicit opt-out.
- Decide coupling of `--rewrite-policy` with `--validate-specifiers` (fail fast when `warn|safe` + validation=false, or document decoupling).
- Consider a `--quiet` flag to reduce log chatter alongside warnings/hazards.
