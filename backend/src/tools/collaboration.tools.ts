import { ToolDefinition, ToolContext } from './tool.interface';
import { slackService } from '../services/slack/slack.service';
import { jiraService } from '../services/jira/jira.service';
import { githubService } from '../services/github/github.service';
import { notionService } from '../services/notion/notion.service';
import { aiService } from '../services/ai/ai.service';

// ------------------------------------------------------------------ Slack
const slackSend: ToolDefinition = {
  name: 'slack_send_message',
  displayName: 'Send Slack Message',
  description: 'Posts a message to a Slack channel; can @mention users by email or @channel',
  provider: 'slack',
  requiresConfirmation: true,
  actionType: 'slack_post',
  parameters: {
    channel: { type: 'string', description: 'Channel name like #engineering or channel ID (default channel if omitted)' },
    message: { type: 'string', description: 'Message text (Slack markdown)', required: true },
    mentionEmails: { type: 'array', description: 'Emails of users to @mention' },
    mentionChannel: { type: 'boolean', description: 'Prefix with @channel' },
  },
  execute: (p, ctx) => slackService.sendMessage(ctx.userId, p),
};

const slackChannels: ToolDefinition = {
  name: 'slack_list_channels',
  displayName: 'List Slack Channels',
  description: 'Lists Slack channels the bot can see',
  provider: 'slack',
  requiresConfirmation: false,
  parameters: {},
  execute: (_p, ctx) => slackService.listChannels(ctx.userId),
};

const slackRead: ToolDefinition = {
  name: 'slack_read_channel',
  displayName: 'Read Slack Channel',
  description: 'Reads recent messages from a Slack channel',
  provider: 'slack',
  requiresConfirmation: false,
  parameters: { channel: { type: 'string', description: 'Channel name or ID' }, limit: { type: 'number', description: 'Messages (default 50)', default: 50 } },
  execute: (p, ctx) => slackService.readChannel(ctx.userId, p),
};

const slackSummarize: ToolDefinition = {
  name: 'slack_summarize_channel',
  displayName: 'Summarize Slack Channel',
  description: 'AI summary, key points and action items of recent conversation in a channel',
  provider: 'slack',
  requiresConfirmation: false,
  parameters: { channel: { type: 'string', description: 'Channel name or ID' }, limit: { type: 'number', description: 'Messages to read (default 80)', default: 80 } },
  async execute(p, ctx) {
    const r: any = await slackService.readChannel(ctx.userId, p);
    const s = await aiService.summarizeConversation(r.channel, r.messages);
    return { channel: r.channel, messageCount: r.messages.length, ...s, simulated: r.simulated };
  },
};

const slackSchedule: ToolDefinition = {
  name: 'slack_schedule_message',
  displayName: 'Schedule Slack Reminder',
  description: 'Schedules a Slack message/reminder for a future time',
  provider: 'slack',
  requiresConfirmation: true,
  actionType: 'slack_schedule',
  parameters: {
    channel: { type: 'string', description: 'Channel name or ID' },
    message: { type: 'string', description: 'Reminder text', required: true },
    postAt: { type: 'string', description: 'ISO date-time to post', required: true },
  },
  execute: (p, ctx) => slackService.scheduleMessage(ctx.userId, p),
};

// ------------------------------------------------------------------ Jira
const jiraCreate: ToolDefinition = {
  name: 'jira_create_issue',
  displayName: 'Create Jira Issue',
  description: 'Creates a Jira ticket. priority "auto" lets AI decide the priority',
  provider: 'jira',
  requiresConfirmation: true,
  actionType: 'jira_create',
  parameters: {
    summary: { type: 'string', description: 'Issue title', required: true },
    description: { type: 'string', description: 'Details / reproduction steps' },
    issueType: { type: 'string', description: 'Bug, Task or Story', default: 'Task' },
    priority: { type: 'string', description: 'Highest, High, Medium, Low or auto' },
    projectKey: { type: 'string', description: 'Project key (defaults to configured project)' },
    assignee: { type: 'string', description: 'Assignee email or name' },
    labels: { type: 'array', description: 'Labels' },
  },
  async execute(p, ctx: ToolContext) {
    let priority = p.priority;
    let aiPriority: any;
    if (!priority || String(priority).toLowerCase() === 'auto') {
      aiPriority = await aiService.detectPriority(`${p.summary}\n${p.description || ''}`);
      priority = aiPriority.priority;
    }
    const r = await jiraService.createIssue(ctx.userId, { ...p, priority });
    return { ...r, priority, aiPriorityReason: aiPriority?.reason };
  },
};

const jiraSearch: ToolDefinition = {
  name: 'jira_search_issues',
  displayName: 'Search Jira Issues',
  description: 'Searches Jira with JQL. Default: my open issues ordered by priority',
  provider: 'jira',
  requiresConfirmation: false,
  parameters: { jql: { type: 'string', description: 'JQL query' }, maxResults: { type: 'number', description: 'Max issues', default: 20 } },
  execute: (p, ctx) => jiraService.searchIssues(ctx.userId, p),
};

const jiraStatus: ToolDefinition = {
  name: 'jira_update_status',
  displayName: 'Update Jira Status',
  description: 'Moves a Jira issue to another status (e.g. "In Progress", "Done")',
  provider: 'jira',
  requiresConfirmation: true,
  actionType: 'jira_transition',
  parameters: { issueKey: { type: 'string', description: 'e.g. AUTO-12', required: true }, status: { type: 'string', description: 'Target status', required: true } },
  execute: (p, ctx) => jiraService.updateStatus(ctx.userId, p),
};

const jiraAssign: ToolDefinition = {
  name: 'jira_assign_issue',
  displayName: 'Assign Jira Issue',
  description: 'Assigns a Jira issue to a developer by email or name',
  provider: 'jira',
  requiresConfirmation: true,
  actionType: 'jira_assign',
  parameters: { issueKey: { type: 'string', description: 'e.g. AUTO-12', required: true }, assignee: { type: 'string', description: 'Email or display name', required: true } },
  execute: (p, ctx) => jiraService.assignIssue(ctx.userId, p),
};

const jiraSprint: ToolDefinition = {
  name: 'jira_sprint_analytics',
  displayName: 'Sprint Analytics',
  description: 'Active sprint progress: completion rate, issues by status and by assignee',
  provider: 'jira',
  requiresConfirmation: false,
  parameters: { projectKey: { type: 'string', description: 'Project key' } },
  execute: (p, ctx) => jiraService.sprintAnalytics(ctx.userId, p),
};

// ------------------------------------------------------------------ GitHub
const ghRepos: ToolDefinition = {
  name: 'github_list_repos',
  displayName: 'List GitHub Repositories',
  description: 'Lists your repositories (most recently updated first)',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { limit: { type: 'number', description: 'Max repos', default: 20 } },
  execute: (p, ctx) => githubService.listRepos(ctx.userId, p),
};

const ghIssue: ToolDefinition = {
  name: 'github_create_issue',
  displayName: 'Create GitHub Issue',
  description: 'Opens an issue in a GitHub repository',
  provider: 'github',
  requiresConfirmation: true,
  actionType: 'github_issue',
  parameters: {
    repo: { type: 'string', description: 'owner/repo (defaults to configured repo)' },
    title: { type: 'string', description: 'Issue title', required: true },
    body: { type: 'string', description: 'Markdown body' },
    labels: { type: 'array', description: 'Labels' },
  },
  execute: (p, ctx) => githubService.createIssue(ctx.userId, p),
};

const ghPRs: ToolDefinition = {
  name: 'github_list_pull_requests',
  displayName: 'List Pull Requests',
  description: 'Lists pull requests of a repository',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { repo: { type: 'string', description: 'owner/repo' }, state: { type: 'string', description: 'open, closed or all', default: 'open' } },
  execute: (p, ctx) => githubService.listPullRequests(ctx.userId, p),
};

const ghPRSummary: ToolDefinition = {
  name: 'github_summarize_pull_request',
  displayName: 'AI Pull Request Summary',
  description: 'AI summary, key changes and risk level of a pull request',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { repo: { type: 'string', description: 'owner/repo' }, number: { type: 'number', description: 'PR number', required: true } },
  async execute(p, ctx) {
    const pr: any = await githubService.getPullRequestDetails(ctx.userId, p);
    const s = await aiService.summarizePullRequest(pr);
    return { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, ...s, simulated: pr.simulated };
  },
};

const ghAnalytics: ToolDefinition = {
  name: 'github_repo_analytics',
  displayName: 'Repository Analytics',
  description: 'Stars, forks, open issues/PRs, commits in last 30 days, contributors and languages',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { repo: { type: 'string', description: 'owner/repo' } },
  execute: (p, ctx) => githubService.repoAnalytics(ctx.userId, p),
};

const ghCommits: ToolDefinition = {
  name: 'github_list_commits',
  displayName: 'Recent Commits',
  description: 'Lists recent commits (commit monitoring)',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { repo: { type: 'string', description: 'owner/repo' }, limit: { type: 'number', description: 'Max commits', default: 15 } },
  execute: (p, ctx) => githubService.listCommits(ctx.userId, p),
};

const ghReleases: ToolDefinition = {
  name: 'github_list_releases',
  displayName: 'List Releases',
  description: 'Lists recent releases (release tracking)',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { repo: { type: 'string', description: 'owner/repo' } },
  execute: (p, ctx) => githubService.listReleases(ctx.userId, p),
};

const ghReleaseNotes: ToolDefinition = {
  name: 'github_generate_release_notes',
  displayName: 'Generate Release Notes',
  description: 'AI-written release notes for a merged pull request',
  provider: 'github',
  requiresConfirmation: false,
  parameters: { repo: { type: 'string', description: 'owner/repo' }, number: { type: 'number', description: 'PR number', required: true } },
  async execute(p, ctx) {
    const pr: any = await githubService.getPullRequestDetails(ctx.userId, p);
    const notes = await aiService.generateReleaseNotes(pr);
    return { repo: pr.repo, number: pr.number, prTitle: pr.title, url: pr.url, ...notes, simulated: pr.simulated || notes.isSimulated };
  },
};

// ------------------------------------------------------------------ Notion
const notionCreate: ToolDefinition = {
  name: 'notion_create_page',
  displayName: 'Create Notion Page',
  description: 'Creates a Notion page (markdown content: headings, bullets, [ ] to-dos)',
  provider: 'notion',
  requiresConfirmation: true,
  actionType: 'notion_page',
  parameters: {
    title: { type: 'string', description: 'Page title', required: true },
    content: { type: 'string', description: 'Markdown content' },
    parentPageId: { type: 'string', description: 'Parent page id (defaults to configured page)' },
  },
  execute: (p, ctx) => notionService.createPage(ctx.userId, p),
};

const notionSearch: ToolDefinition = {
  name: 'notion_search',
  displayName: 'Search Notion',
  description: 'Searches Notion pages shared with the integration',
  provider: 'notion',
  requiresConfirmation: false,
  parameters: { query: { type: 'string', description: 'Search text', required: true } },
  execute: (p, ctx) => notionService.search(ctx.userId, p),
};

export const collaborationTools = [
  slackSend, slackChannels, slackRead, slackSummarize, slackSchedule,
  jiraCreate, jiraSearch, jiraStatus, jiraAssign, jiraSprint,
  ghRepos, ghIssue, ghPRs, ghPRSummary, ghAnalytics, ghCommits, ghReleases, ghReleaseNotes,
  notionCreate, notionSearch,
];
