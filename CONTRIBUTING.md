# Contributing to MobSimLab

Thank you for helping. MobSimLab is licensed AGPL-3.0-or-later (code) and CC BY 4.0 (vehicle catalogue, assumption library, documentation).

## Developer Certificate of Origin

Every commit must be signed off (`git commit -s`), which adds a line such as

    Signed-off-by: Your Name <you@example.org>

By signing off you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/): you wrote the change or have the right to submit it under the project's licences. CI rejects pull requests with commits that are not signed off.

## Before you open a pull request

- Read the architecture in `docs/architecture/` and the ADRs in `docs/adr/`. A change to a decision needs a new or updated ADR.
- Run the checks for the parts you changed:
  - Web and API: `pnpm install && pnpm lint && pnpm typecheck && pnpm test`
  - Worker: `cd worker && uv sync && uv run ruff check . && uv run mypy && uv run pytest`
  - Kernels: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --exclude mobsim-py`
- Every public function needs a doc comment with purpose, inputs, outputs and side effects.
- New dependencies must pass the licence gate (`tools/license-gate`). Changing its policy needs an ADR.
- Values used in calculations need a source, or an assumption record with a range (docs/architecture/09-planning-models.md §1).
- Never commit secrets. Use `deploy/scripts/init-secrets` for local development.

## Security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
