import { Octokit } from '@octokit/rest';
import { config } from '../../config.js';

export function matchIssueToFiles(issue, fileIds) {
  const text = `${issue.title || ''}\n${issue.body || ''}`;
  const paths = text.match(/[\w@./-]+\.(?:js|jsx|ts|tsx|mjs|cjs)\b/g) || [];
  const identifiers = new Set((text.match(/\b[A-Za-z_$][\w$]{2,}\b/g) || []).map(s => s.toLowerCase()));
  const matches = new Set();
  for (const candidate of paths) {
    const clean = candidate.replace(/^\.\//, '');
    if (fileIds.includes(clean)) matches.add(clean);
  }
  if (!matches.size) for (const id of fileIds) if (identifiers.has(id.split('/').at(-1).toLowerCase().replace(/\.[^.]+$/, ''))) matches.add(id);
  return [...matches].sort();
}

export async function fetchGoodFirstIssues(owner, repo, fileIds) {
  if (!config.githubToken) return { available: false, reason: 'GITHUB_TOKEN is not configured.', issues: [] };
  const octokit = new Octokit({ auth: config.githubToken });
  try {
    const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state: 'open', labels: 'good first issue', per_page: 30 });
    return { available: true, issues: data.filter(item => !item.pull_request).map(issue => ({
      number: issue.number, title: issue.title, url: issue.html_url, createdAt: issue.created_at,
      matches: matchIssueToFiles(issue, fileIds), heuristic: true
    })) };
  } catch (error) {
    return { available: false, reason: error.message || 'GitHub issue lookup failed.', issues: [] };
  }
}
