import { getCredentials, JiraCreds } from '../integrations/credentials.service';
import { httpJSON, IntegrationError } from '../integrations/http';
import { liveOrDemo, DEMO_JIRA_ISSUES, nextDemoId } from '../integrations/demo';

function base(creds: JiraCreds) {
  return `https://${creds.host.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
}
function headers(creds: JiraCreds) {
  return { Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}` };
}

/** Plain text → Atlassian Document Format (required by Jira Cloud REST v3). */
export function toADF(text: string) {
  const paragraphs = (text || '').split(/\n{2,}/).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: (paragraphs.length ? paragraphs : ['']).map((p) => ({
      type: 'paragraph',
      content: p ? p.split('\n').flatMap((line, i, arr) => [{ type: 'text', text: line || ' ' }, ...(i < arr.length - 1 ? [{ type: 'hardBreak' }] : [])]) : [],
    })),
  };
}

function mapIssue(i: any, creds?: JiraCreds) {
  return {
    key: i.key,
    summary: i.fields?.summary,
    status: i.fields?.status?.name,
    priority: i.fields?.priority?.name,
    assignee: i.fields?.assignee?.displayName,
    issueType: i.fields?.issuetype?.name,
    updated: i.fields?.updated,
    url: creds ? `${base(creds)}/browse/${i.key}` : undefined,
  };
}

class JiraService {
  private async creds(userId: string) {
    return (await getCredentials(userId, 'jira'))?.creds || null;
  }

  public async testConnection(creds: JiraCreds) {
    const me = await httpJSON<any>('jira', `${base(creds)}/rest/api/3/myself`, { headers: headers(creds) });
    return { accountName: me.displayName, accountEmail: me.emailAddress || creds.email, metadata: { accountId: me.accountId, host: creds.host } };
  }

  private async projectKey(creds: JiraCreds, given?: string): Promise<string> {
    if (given) return given;
    if (creds.defaultProject) return creds.defaultProject;
    const r = await httpJSON<any>('jira', `${base(creds)}/rest/api/3/project/search?maxResults=1`, { headers: headers(creds) });
    const key = r.values?.[0]?.key;
    if (!key) throw new IntegrationError('jira', 'No Jira project found. Create a project or set a default project key.', 400);
    return key;
  }

  private async findAccountId(creds: JiraCreds, query: string): Promise<string | null> {
    if (!query) return null;
    const users = await httpJSON<any[]>('jira', `${base(creds)}/rest/api/3/user/search?query=${encodeURIComponent(query)}`, { headers: headers(creds) });
    return users?.[0]?.accountId || null;
  }

  public async createIssue(userId: string, p: { projectKey?: string; summary: string; description?: string; issueType?: string; priority?: string; assignee?: string; labels?: string[] }) {
    return liveOrDemo('jira', await this.creds(userId), async (creds) => {
      const projectKey = await this.projectKey(creds, p.projectKey);
      const fields: any = {
        project: { key: projectKey },
        summary: (p.summary || 'Untitled issue').slice(0, 250),
        description: toADF(p.description || ''),
        issuetype: { name: p.issueType || 'Task' },
      };
      if (p.labels?.length) fields.labels = p.labels.map((l) => l.replace(/\s+/g, '-'));
      if (p.priority) fields.priority = { name: p.priority };
      const create = async (f: any) => httpJSON<any>('jira', `${base(creds)}/rest/api/3/issue`, { method: 'POST', headers: headers(creds), body: { fields: f } });
      let r: any;
      try {
        r = await create(fields);
      } catch (err: any) {
        // Team-managed projects often lack "Bug" type or the priority field — retry with safe defaults
        if (/issuetype|priority/i.test(err.message)) {
          delete fields.priority;
          fields.issuetype = { name: 'Task' };
          r = await create(fields);
        } else throw err;
      }
      if (p.assignee) {
        const accountId = await this.findAccountId(creds, p.assignee).catch(() => null);
        if (accountId) await httpJSON('jira', `${base(creds)}/rest/api/3/issue/${r.key}/assignee`, { method: 'PUT', headers: headers(creds), body: { accountId } }).catch(() => null);
      }
      return { status: 'created', key: r.key, url: `${base(creds)}/browse/${r.key}`, message: `Created Jira issue ${r.key}` };
    }, () => {
      const key = `AUTO-${nextDemoId()}`;
      return { status: 'created', key, url: '#', message: `Simulated Jira issue ${key}: ${p.summary}`, stagedAction: p };
    });
  }

  public async searchIssues(userId: string, p: { jql?: string; maxResults?: number }) {
    return liveOrDemo('jira', await this.creds(userId), async (creds) => {
      const jql = p.jql || 'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC';
      const r = await httpJSON<any>('jira', `${base(creds)}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: headers(creds),
        body: { jql, maxResults: p.maxResults || 20, fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'updated'] },
      });
      return { jql, issues: (r.issues || []).map((i: any) => mapIssue(i, creds)) };
    }, () => ({ jql: p.jql || 'statusCategory != Done', issues: DEMO_JIRA_ISSUES }));
  }

  public async updateStatus(userId: string, p: { issueKey: string; status: string }) {
    return liveOrDemo('jira', await this.creds(userId), async (creds) => {
      const t = await httpJSON<any>('jira', `${base(creds)}/rest/api/3/issue/${p.issueKey}/transitions`, { headers: headers(creds) });
      const transition = (t.transitions || []).find((x: any) => x.name.toLowerCase() === p.status.toLowerCase() || x.to?.name?.toLowerCase() === p.status.toLowerCase());
      if (!transition) throw new IntegrationError('jira', `No transition to "${p.status}". Available: ${(t.transitions || []).map((x: any) => x.to?.name).join(', ')}`, 400);
      await httpJSON('jira', `${base(creds)}/rest/api/3/issue/${p.issueKey}/transitions`, { method: 'POST', headers: headers(creds), body: { transition: { id: transition.id } } });
      return { status: 'updated', issueKey: p.issueKey, newStatus: transition.to?.name, message: `${p.issueKey} → ${transition.to?.name}` };
    }, () => ({ status: 'updated', issueKey: p.issueKey, newStatus: p.status, message: `Simulated: ${p.issueKey} → ${p.status}` }));
  }

  public async assignIssue(userId: string, p: { issueKey: string; assignee: string }) {
    return liveOrDemo('jira', await this.creds(userId), async (creds) => {
      const accountId = await this.findAccountId(creds, p.assignee);
      if (!accountId) throw new IntegrationError('jira', `No Jira user matches "${p.assignee}"`, 400);
      await httpJSON('jira', `${base(creds)}/rest/api/3/issue/${p.issueKey}/assignee`, { method: 'PUT', headers: headers(creds), body: { accountId } });
      return { status: 'assigned', issueKey: p.issueKey, assignee: p.assignee, message: `${p.issueKey} assigned to ${p.assignee}` };
    }, () => ({ status: 'assigned', issueKey: p.issueKey, assignee: p.assignee, message: `Simulated: ${p.issueKey} assigned to ${p.assignee}` }));
  }

  public async sprintAnalytics(userId: string, p: { projectKey?: string }) {
    return liveOrDemo('jira', await this.creds(userId), async (creds) => {
      const projectKey = await this.projectKey(creds, p.projectKey);
      const boards = await httpJSON<any>('jira', `${base(creds)}/rest/agile/1.0/board?projectKeyOrId=${projectKey}`, { headers: headers(creds) });
      const board = boards.values?.find((b: any) => b.type === 'scrum') || boards.values?.[0];
      let sprintName = 'No active sprint';
      let issues: any[] = [];
      if (board) {
        const sprints = await httpJSON<any>('jira', `${base(creds)}/rest/agile/1.0/board/${board.id}/sprint?state=active`, { headers: headers(creds) }).catch(() => ({ values: [] }));
        const sprint = sprints.values?.[0];
        if (sprint) {
          sprintName = sprint.name;
          const r = await httpJSON<any>('jira', `${base(creds)}/rest/agile/1.0/sprint/${sprint.id}/issue?maxResults=200&fields=status,priority,assignee,summary,issuetype`, { headers: headers(creds) });
          issues = r.issues || [];
        }
      }
      if (!issues.length) {
        const r = await httpJSON<any>('jira', `${base(creds)}/rest/api/3/search/jql`, { method: 'POST', headers: headers(creds), body: { jql: `project = ${projectKey} AND updated >= -14d`, maxResults: 100, fields: ['status', 'priority', 'assignee', 'summary', 'issuetype'] } });
        issues = r.issues || [];
        if (sprintName === 'No active sprint') sprintName = `${projectKey} — last 14 days`;
      }
      return summarizeSprint(sprintName, issues.map((i) => mapIssue(i, creds)));
    }, () => summarizeSprint('Sprint 14 (demo)', DEMO_JIRA_ISSUES));
  }
}

function summarizeSprint(sprintName: string, issues: any[]) {
  const byStatus: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  issues.forEach((i) => {
    byStatus[i.status || 'Unknown'] = (byStatus[i.status || 'Unknown'] || 0) + 1;
    byAssignee[i.assignee || 'Unassigned'] = (byAssignee[i.assignee || 'Unassigned'] || 0) + 1;
  });
  const done = issues.filter((i) => /done|closed|resolved/i.test(i.status || '')).length;
  return {
    sprint: sprintName,
    total: issues.length,
    done,
    completionRate: issues.length ? Math.round((done / issues.length) * 100) : 0,
    byStatus,
    byAssignee,
    summary: `${sprintName}: ${done}/${issues.length} issues done (${issues.length ? Math.round((done / issues.length) * 100) : 0}%).`,
  };
}

export const jiraService = new JiraService();
