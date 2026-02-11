# GitHub API Push

Push files to GitHub via API - useful when `git push` fails due to corporate proxy/firewall issues but API calls work.

## Why?

On some corporate networks, `git push` over HTTPS fails due to:
- SSL inspection proxies intercepting credentials
- Firewall rules blocking git protocol
- Windows credential manager issues

However, GitHub API calls through the proxy often still work. This script pushes files one-by-one using the Contents API.

## Installation

```bash
# Clone or download push.js to your project
curl -O https://raw.githubusercontent.com/slavingia/github-api-push/main/push.js

# Or add as a dev dependency
npm install node-fetch https-proxy-agent
```

## Usage

```bash
# Set your GitHub token
export GITHUB_TOKEN="ghp_your_token_here"

# Push current branch (all tracked files)
node push.js

# Push specific branch
node push.js feature/my-branch

# Push specific files
node push.js --files "src/index.js,README.md"

# Push to different repo
node push.js --repo owner/repo

# Dry run (show what would be uploaded)
node push.js --dry-run

# Show all options
node push.js --help
```

## Options

| Option | Description |
|--------|-------------|
| `--branch, -b <name>` | Target branch (default: current git branch) |
| `--repo, -r <owner/repo>` | Target repository (default: from git remote) |
| `--token, -t <token>` | GitHub token (default: GITHUB_TOKEN env var) |
| `--files, -f <list>` | Comma-separated files (default: all git tracked) |
| `--message, -m <msg>` | Commit message prefix (default: "Update") |
| `--proxy, -p <url>` | Proxy URL (default: http://127.0.0.1:3128) |
| `--create` | Create branch if missing (default) |
| `--no-create` | Fail if branch doesn't exist |
| `--dry-run` | Show files without uploading |
| `--help, -h` | Show help |

## Requirements

- Node.js 14+
- `node-fetch` (v2 or v3)
- `https-proxy-agent` (for proxy support)

## License

MIT
