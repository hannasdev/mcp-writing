---
applyTo: "**"
---

# Contribution Workflow

How to structure branches and PRs for this project.

## Branch Naming Convention

Branch names should use semantic prefixes aligned with [conventional commits](https://www.conventionalcommits.org/):

| Prefix | Use Case | Example |
|--------|----------|---------|
| `feat/` | New feature | `feat/embeddings-search` |
| `fix/` | Bug fix | `fix/scene-staleness-check` |
| `docs/` | Documentation only | `docs/copilot-instructions` |
| `chore/` | Maintenance, deps, tooling | `chore/update-eslint` |
| `refactor/` | Code restructuring (no behavior change) | `refactor/metadata-types` |

**Important**: Version bumps are inferred from conventional commit messages, not branch names. See [MAINTAINERS.md](../../MAINTAINERS.md) for how `release.yml` determines version increments.

## Workflow

1. **Create a feature branch from `main`**:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b <prefix>/<kebab-case-description>
   ```

2. **Make focused commits**:
   - Use conventional commit format: `<type>(<scope>): <message>`
   - Example: `docs: add copilot-instructions for MCP discovery`

3. **Push and open PR**:
   ```bash
   git push -u origin <branch-name>
   ```
   - GitHub will suggest creating a PR
   - Write a clear description explaining the change

4. **Merge strategy**:
   - Default: **squash merge** (linear history)
   - Exception: rebase merge if the branch contains multiple meaningful commits
   - Avoid merge commits unless explicitly needed

## Examples

**Good branch name:**
- `feat/import-async` — clear, short, uses semantic prefix
- `docs/copilot-instructions` — documentation, follows convention
- `fix/metadata-stale-detection` — scope is clear

**Poor branch name:**
- `add-copilot-instructions` — no semantic prefix, harder to categorize
- `feature/metadata-refactor-and-tests` — too long, mixes concerns
- `update-stuff` — vague, not semantic

## See Also

- [AGENTS.md](../../AGENTS.md) — Project-specific development guidelines
- [MAINTAINERS.md](../../MAINTAINERS.md) — Release automation and versioning
- [Conventional Commits](https://www.conventionalcommits.org/) — Full specification
