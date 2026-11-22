import { getCredentials, GithubCreds } from '../integrations/credentials.service';
import { httpJSON, IntegrationError } from '../integrations/http';
import { liveOrDemo, DEMO_GITHUB_REPOS, DEMO_PULL_REQUESTS, nextDemoId } from '../integrations/demo';

const API = 'https://api.github.com';
const h = (c: GithubCreds) => ({ Authorization: `Bearer ${c.token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', 'User-Agent': 'AutoFlow-AI' });

function repoOf(c: GithubCreds, repo?: string): string {
  const r = (repo || c.defaultRepo || '').replace(/^https?:\/\/github.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new IntegrationError('github', 'Repository must be "owner/repo" (or set a default repository)', 400);
  return r;
}

class GithubService {
  private async creds(userId: string) {
    return (await getCredentials(userId, 'github'))?.creds || null;
  }

  public async testConnection(creds: GithubCreds) {
    const u = await httpJSON<any>('github', `${API}/user`, { headers: h(creds) });
    return { accountName: u.login, accountEmail: u.email || undefined, metadata: { login: u.login, avatar: u.avatar_url } };
  }

  public async listRepos(userId: string, p: { limit?: number } = {}) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const r = await httpJSON<any[]>('github', `${API}/user/repos?sort=updated&per_page=${p.limit || 20}`, { headers: h(c) });
      return { repositories: r.map((x) => ({ fullName: x.full_name, description: x.description, language: x.language, stars: x.stargazers_count, openIssues: x.open_issues_count, updatedAt: x.updated_at, url: x.html_url, private: x.private })) };
    }, () => ({ repositories: DEMO_GITHUB_REPOS }));
  }

  public async createIssue(userId: string, p: { repo?: string; title: string; body?: string; labels?: string[] }) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const repo = repoOf(c, p.repo);
      const r = await httpJSON<any>('github', `${API}/repos/${repo}/issues`, { method: 'POST', headers: h(c), body: { title: p.title, body: p.body || '', labels: p.labels || [] } });
      return { status: 'created', number: r.number, url: r.html_url, repo, message: `Opened ${repo}#${r.number}` };
    }, () => {
      const n = nextDemoId();
      return { status: 'created', number: n, url: '#', repo: p.repo || 'autoflow-ai/platform-api', message: `Simulated GitHub issue #${n}: ${p.title}` };
    });
  }

  public async listPullRequests(userId: string, p: { repo?: string; state?: 'open' | 'closed' | 'all' }) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const repo = repoOf(c, p.repo);
      const r = await httpJSON<any[]>('github', `${API}/repos/${repo}/pulls?state=${p.state || 'open'}&per_page=20`, { headers: h(c) });
      return { repo, pullRequests: r.map((x) => ({ number: x.number, title: x.title, author: x.user?.login, state: x.merged_at ? 'merged' : x.state, url: x.html_url, createdAt: x.created_at })) };
    }, () => ({ repo: p.repo || 'autoflow-ai/platform-api', pullRequests: DEMO_PULL_REQUESTS }));
  }

  public async getPullRequestDetails(userId: string, p: { repo?: string; number: number }) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const repo = repoOf(c, p.repo);
      const [pr, files, commits] = await Promise.all([
        httpJSON<any>('github', `${API}/repos/${repo}/pulls/${p.number}`, { headers: h(c) }),
        httpJSON<any[]>('github', `${API}/repos/${repo}/pulls/${p.number}/files?per_page=100`, { headers: h(c) }),
        httpJSON<any[]>('github', `${API}/repos/${repo}/pulls/${p.number}/commits?per_page=100`, { headers: h(c) }),
      ]);
      return {
        repo,
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        author: pr.user?.login,
        merged: Boolean(pr.merged_at),
        url: pr.html_url,
        additions: pr.additions,
        deletions: pr.deletions,
        files: files.map((f) => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`),
        commits: commits.map((x) => x.commit?.message?.split('\n')[0]),
      };
    }, () => {
      const demo = DEMO_PULL_REQUESTS.find((x) => x.number === Number(p.number)) || DEMO_PULL_REQUESTS[0];
      return { repo: p.repo || 'autoflow-ai/platform-api', ...demo, body: 'Adds Block Kit formatting for workflow digests and fixes token refresh.', merged: true, files: ['modified src/slack/formatter.ts (+180/-20)', 'added tests/formatter.test.ts (+60/-0)'], commits: ['feat: block kit digest formatter', 'fix: escape markdown in subjects', 'test: formatter snapshots'] };
    });
  }

  public async listCommits(userId: string, p: { repo?: string; limit?: number }) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const repo = repoOf(c, p.repo);
      const r = await httpJSON<any[]>('github', `${API}/repos/${repo}/commits?per_page=${p.limit || 15}`, { headers: h(c) });
      return { repo, commits: r.map((x) => ({ sha: x.sha.slice(0, 7), message: x.commit.message.split('\n')[0], author: x.commit.author?.name, date: x.commit.author?.date, url: x.html_url })) };
    }, () => ({ repo: p.repo || 'autoflow-ai/platform-api', commits: [{ sha: 'a1b2c3d', message: 'fix: refresh OAuth tokens', author: 'Rahul', date: new Date().toISOString() }, { sha: 'e4f5a6b', message: 'feat: Slack digest formatter', author: 'Priya', date: new Date().toISOString() }] }));
  }

  public async listReleases(userId: string, p: { repo?: string }) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const repo = repoOf(c, p.repo);
      const r = await httpJSON<any[]>('github', `${API}/repos/${repo}/releases?per_page=10`, { headers: h(c) });
      return { repo, releases: r.map((x) => ({ tag: x.tag_name, name: x.name, publishedAt: x.published_at, url: x.html_url, draft: x.draft })) };
    }, () => ({ repo: p.repo || 'autoflow-ai/platform-api', releases: [{ tag: 'v2.3.0', name: 'Workflow Engine 2.3', publishedAt: new Date().toISOString() }] }));
  }

  public async repoAnalytics(userId: string, p: { repo?: string }) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const repo = repoOf(c, p.repo);
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [info, languages, commits, pulls, contributors] = await Promise.all([
        httpJSON<any>('github', `${API}/repos/${repo}`, { headers: h(c) }),
        httpJSON<Record<string, number>>('github', `${API}/repos/${repo}/languages`, { headers: h(c) }),
        httpJSON<any[]>('github', `${API}/repos/${repo}/commits?since=${since}&per_page=100`, { headers: h(c) }),
        httpJSON<any[]>('github', `${API}/repos/${repo}/pulls?state=open&per_page=100`, { headers: h(c) }),
        httpJSON<any[]>('github', `${API}/repos/${repo}/contributors?per_page=100`, { headers: h(c) }).catch(() => []),
      ]);
      const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
      return {
        repo,
        stars: info.stargazers_count,
        forks: info.forks_count,
        openIssues: info.open_issues_count,
        openPullRequests: pulls.length,
        commitsLast30Days: commits.length,
        contributors: contributors.length,
        languages: Object.fromEntries(Object.entries(languages).map(([k, v]) => [k, Math.round((v / total) * 100)])),
        defaultBranch: info.default_branch,
        summary: `${repo}: ${commits.length} commits in 30 days, ${pulls.length} open PRs, ${info.open_issues_count} open issues.`,
      };
    }, () => ({ repo: p.repo || 'autoflow-ai/platform-api', stars: 128, forks: 21, openIssues: 14, openPullRequests: 2, commitsLast30Days: 47, contributors: 6, languages: { TypeScript: 86, CSS: 9, Shell: 5 }, defaultBranch: 'main', summary: 'autoflow-ai/platform-api: 47 commits in 30 days, 2 open PRs, 14 open issues.' }));
  }

  public async searchIssues(userId: string, query: string) {
    return liveOrDemo('github', await this.creds(userId), async (c) => {
      const me = await httpJSON<any>('github', `${API}/user`, { headers: h(c) });
      const scope = c.defaultRepo ? `repo:${c.defaultRepo}` : `user:${me.login}`;
      const r = await httpJSON<any>('github', `${API}/search/issues?q=${encodeURIComponent(`${query} ${scope}`)}&per_page=10`, { headers: h(c) });
      return { items: (r.items || []).map((x: any) => ({ title: x.title, url: x.html_url, number: x.number, state: x.state, isPR: Boolean(x.pull_request) })) };
    }, () => ({ items: DEMO_PULL_REQUESTS.filter((x) => x.title.toLowerCase().includes(query.toLowerCase().split(' ')[0] || '')).map((x) => ({ title: x.title, url: x.url, number: x.number, state: x.state, isPR: true })) }));
  }
}

export const githubService = new GithubService();
