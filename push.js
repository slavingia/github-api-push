#!/usr/bin/env node
/**
 * GitHub Push Script - Push files to GitHub via API
 *
 * Useful when git push fails due to corporate proxy/firewall issues
 * but GitHub API calls work.
 *
 * Usage:
 *   node push-all.js [options]
 *
 * Options:
 *   --branch, -b     Target branch name (default: current git branch)
 *   --repo, -r       Repository in format owner/repo (default: from git remote)
 *   --token, -t      GitHub token (default: GITHUB_TOKEN env var)
 *   --files, -f      Comma-separated list of files to push (default: all tracked)
 *   --message, -m    Commit message prefix (default: "Update")
 *   --create         Create branch from main if it doesn't exist
 *   --dry-run        Show what would be uploaded without uploading
 *   --help, -h       Show this help
 *
 * Examples:
 *   node push-all.js --branch feature/my-feature
 *   node push-all.js -b main -f "src/index.js,README.md"
 *   node push-all.js --repo myorg/myrepo --token ghp_xxxxx
 *   GITHUB_TOKEN=ghp_xxx node push-all.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    branch: null,
    repo: null,
    token: process.env.GITHUB_TOKEN,
    files: null,
    message: 'Update',
    create: true,
    dryRun: false,
    help: false,
    proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:3128'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--branch':
      case '-b':
        options.branch = next;
        i++;
        break;
      case '--repo':
      case '-r':
        options.repo = next;
        i++;
        break;
      case '--token':
      case '-t':
        options.token = next;
        i++;
        break;
      case '--files':
      case '-f':
        options.files = next ? next.split(',').map(f => f.trim()) : null;
        i++;
        break;
      case '--message':
      case '-m':
        options.message = next;
        i++;
        break;
      case '--proxy':
      case '-p':
        options.proxy = next;
        i++;
        break;
      case '--create':
        options.create = true;
        break;
      case '--no-create':
        options.create = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        // Positional argument - treat first as branch
        if (!arg.startsWith('-') && !options.branch) {
          options.branch = arg;
        }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
GitHub Push Script - Push files to GitHub via API

Usage:
  node push-all.js [options] [branch]

Options:
  --branch, -b <name>    Target branch name (default: current git branch)
  --repo, -r <owner/repo> Repository (default: from git remote origin)
  --token, -t <token>    GitHub token (default: GITHUB_TOKEN env var)
  --files, -f <list>     Comma-separated files to push (default: all tracked)
  --message, -m <msg>    Commit message prefix (default: "Update")
  --proxy, -p <url>      Proxy URL (default: http://127.0.0.1:3128)
  --create               Create branch from main if missing (default)
  --no-create            Fail if branch doesn't exist
  --dry-run              Show files without uploading
  --help, -h             Show this help

Examples:
  node push-all.js feature/my-feature
  node push-all.js --branch main --files "src/index.js,README.md"
  node push-all.js -r myorg/myrepo -t ghp_xxxxx
  GITHUB_TOKEN=ghp_xxx node push-all.js --dry-run
`);
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'main';
  }
}

function getGitRepo() {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    // Extract owner/repo from various URL formats
    const match = url.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
    if (match) {
      return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
    }
  } catch {
    // ignore
  }
  return null;
}

function getTrackedFiles() {
  try {
    const output = execSync('git ls-files', { encoding: 'utf8' });
    return output.split('\n').filter(f => f.trim() && !f.startsWith('.git'));
  } catch {
    return [];
  }
}

async function createFetcher(proxyUrl) {
  const fetch = (await import('node-fetch')).default;

  let agent = null;
  if (proxyUrl) {
    try {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      agent = new HttpsProxyAgent(proxyUrl);
    } catch {
      console.warn('Warning: https-proxy-agent not available, proceeding without proxy');
    }
  }

  return async (url, options = {}) => {
    const fetchOptions = {
      ...options,
      headers: {
        'User-Agent': 'github-push-script',
        ...options.headers
      }
    };
    if (agent) fetchOptions.agent = agent;
    return fetch(url, fetchOptions);
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Resolve defaults
  const branch = options.branch || getGitBranch();
  const repo = options.repo || getGitRepo();
  const token = options.token;
  const files = options.files || getTrackedFiles();

  // Validate
  if (!token) {
    console.error('Error: GitHub token required. Set GITHUB_TOKEN env var or use --token');
    process.exit(1);
  }

  if (!repo) {
    console.error('Error: Could not determine repository. Use --repo owner/repo');
    process.exit(1);
  }

  if (!files.length) {
    console.error('Error: No files to push');
    process.exit(1);
  }

  console.log(`Repository: ${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Files: ${files.length}`);
  if (options.dryRun) console.log('Mode: DRY RUN');
  console.log('');

  if (options.dryRun) {
    console.log('Files that would be uploaded:');
    files.forEach(f => console.log(`  ${f}`));
    process.exit(0);
  }

  const fetcher = await createFetcher(options.proxy);

  async function api(endpoint, fetchOptions = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
    const response = await fetcher(url, {
      ...fetchOptions,
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        ...fetchOptions.headers
      }
    });
    return response.json();
  }

  // Ensure branch exists
  const refResult = await api(`/repos/${repo}/git/refs/heads/${branch}`);

  if (refResult.message === 'Not Found') {
    if (!options.create) {
      console.error(`Error: Branch '${branch}' does not exist. Use --create to create it.`);
      process.exit(1);
    }

    console.log(`Creating branch '${branch}' from main...`);
    const mainRef = await api(`/repos/${repo}/git/refs/heads/main`);
    if (!mainRef.object?.sha) {
      console.error('Error: Could not find main branch');
      process.exit(1);
    }

    const createResult = await api(`/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: mainRef.object.sha
      })
    });

    if (!createResult.ref) {
      console.error(`Error: Failed to create branch: ${createResult.message}`);
      process.exit(1);
    }
    console.log(`✓ Created branch '${branch}'\n`);
  }

  // Upload files
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = path.resolve(file);

    if (!fs.existsSync(fullPath)) {
      console.log(`⚠ ${file} - not found, skipping`);
      skipped++;
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      skipped++;
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath);

      // Check if file exists on remote
      const existing = await api(`/repos/${repo}/contents/${file}?ref=${branch}`);

      const body = {
        message: `${options.message} ${file}`,
        branch,
        content: content.toString('base64')
      };
      if (existing.sha) body.sha = existing.sha;

      const result = await api(`/repos/${repo}/contents/${file}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (result.content) {
        console.log(`✓ ${file}`);
        success++;
      } else {
        console.log(`✗ ${file}: ${result.message}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${file}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✓ Done! ${success} uploaded, ${failed} failed, ${skipped} skipped`);
  console.log(`\nView: https://github.com/${repo}/tree/${branch}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
