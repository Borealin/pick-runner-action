# Pick Runner Action

[![GitHub Super-Linter](https://github.com/actions/javascript-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/actions/javascript-action/actions/workflows/ci.yml/badge.svg)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

A GitHub Action that intelligently selects between self-hosted and GitHub-hosted
runners based on availability and usage limits.

## Features

- **🎯 Smart Runner Selection**: Prioritizes self-hosted runners when available
- **⚡ Intelligent Fallback**: Falls back to GitHub-hosted runners based on
  usage limits
- **🔧 Configurable Thresholds**: Set minimum remaining minutes for
  GitHub-hosted runners
- **📊 JSON Output**: Consistent JSON format for both single and multiple runner
  tags
- **🏢 Multi-Repository Support**: Works with both personal and organization
  repositories
- **🔍 Automatic Detection**: Automatically detects repository type and uses
  appropriate APIs

## Usage

```yaml
- name: Pick Runner
  id: pick-runner
  uses: your-org/pick-runner-action@v1
  with:
    self-hosted-tags: "linux,self-hosted"
    github-hosted-tags: "ubuntu-latest"
    github-hosted-limit: 1000
    github-token: ${{ secrets.PAT_TOKEN }}  # Use PAT with appropriate permissions

- name: Run job on selected runner
  runs-on: ${{ fromJSON(steps.pick-runner.outputs.selected-runner) }}
  steps:
    - run: echo "Running on ${{ steps.pick-runner.outputs.runner-type }}"
    - run: echo "Selection reason: ${{ steps.pick-runner.outputs.reason }}"
```

## Inputs

| Input                 | Required | Default | Description                                                            |
| --------------------- | -------- | ------- | ---------------------------------------------------------------------- |
| `self-hosted-tags`    | ✅       | -       | Self-hosted runner labels (comma-separated, e.g., "linux,self-hosted") |
| `github-hosted-tags`  | ✅       | -       | GitHub-hosted runner labels (comma-separated, e.g., "ubuntu-latest")   |
| `github-hosted-limit` | ✅       | `1000`  | Minimum remaining minutes threshold for GitHub-hosted runners          |
| `github-token`        | ✅       | -       | Personal Access Token with self-hosted runners and billing permissions |

## Outputs

| Output            | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `selected-runner` | Selected runner labels in JSON format                      |
| `runner-type`     | Type of runner selected ("self-hosted" or "github-hosted") |
| `reason`          | Explanation for the selection decision                     |

## Selection Logic

1. **Check Self-Hosted Runners**
   - If self-hosted runners are online and available → Use self-hosted runners

2. **Check GitHub-Hosted Usage**
   - If self-hosted runners are busy → Check GitHub-hosted runner usage
   - If remaining minutes ≥ threshold → Use GitHub-hosted runners

3. **Fallback to Self-Hosted**
   - If GitHub-hosted usage exceeds threshold → Use self-hosted runners (even if
     busy)

## Permission Requirements

⚠️ **Important**: The default `GITHUB_TOKEN` usually doesn't have sufficient
permissions for this action. You need to create a Personal Access Token (PAT)
with appropriate scopes.

### Personal Access Token (Classic) Scopes

**For Organization Repositories:**

- `admin:org` scope (for organization-level self-hosted runners and billing)

**For Personal Repositories:**

- `repo` scope (for repository-level self-hosted runners)
- `user` scope (for user billing information)

### Fine-grained Personal Access Token Permissions

**For Organization Repositories:**

- Organization permissions: "Self-hosted runners" (read)
- Organization permissions: "Administration" (read) for billing

**For Personal Repositories:**

- Repository permissions: "Self-hosted runners" (read)
- Account permissions: "Billing" (read)

### Setup Instructions

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with the required scopes/permissions above
3. Add the token to your repository secrets as `PAT_TOKEN`
4. Use `${{ secrets.PAT_TOKEN }}` instead of `${{ secrets.GITHUB_TOKEN }}`

## Examples

### Basic Usage

```yaml
- name: Select Runner
  id: runner
  uses: your-org/pick-runner-action@v1
  with:
    self-hosted-tags: 'linux,self-hosted'
    github-hosted-tags: 'ubuntu-latest'
    github-hosted-limit: 500
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Multiple Runner Tags

```yaml
- name: Select Runner
  id: runner
  uses: your-org/pick-runner-action@v1
  with:
    self-hosted-tags: 'linux,gpu,large'
    github-hosted-tags: 'ubuntu-latest,macos-latest'
    github-hosted-limit: 2000
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Using the Output

```yaml
# The output is always in JSON format, use fromJSON to parse
- name: Run Tests
  runs-on: ${{ fromJSON(steps.runner.outputs.selected-runner) }}
  steps:
    - run: echo "Running on ${{ steps.runner.outputs.runner-type }}"
```

## Development

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the action
npm run package

# Run all checks
npm run all
```

### Testing

```bash
# Run unit tests
npm test

# Run linting
npm run lint

# Check formatting
npm run format:check

# Generate coverage report
npm run coverage
```

## How It Works

1. **Repository Detection**: Automatically detects if the repository belongs to
   an organization or user
2. **API Selection**: Uses appropriate GitHub API endpoints based on repository
   type
3. **Runner Status Check**: Checks availability and status of self-hosted
   runners
4. **Usage Analysis**: Analyzes GitHub Actions billing information
5. **Smart Decision**: Makes an intelligent choice based on availability and
   usage thresholds

## Notes

- Repository owner and name are automatically detected from
  `GITHUB_REPOSITORY_OWNER` and `GITHUB_REPOSITORY` environment variables
- Usage limits are measured in minutes
- Output is always in JSON format - use `fromJSON()` to parse in workflows
- Self-hosted runners for personal repositories are repository-level, while
  organization repositories use organization-level runners

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run `npm run all` to ensure all checks pass
6. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.
