import { AgentStepResult } from './ai.provider';
import { parseNaturalDateTime, addMinutesLocal } from '../../utils/date-parse';
import { env } from '../../config/env.config';

/**
 * Deterministic planner used when no Gemini key is configured (or the model call fails).
 * It covers the demo scenarios from the project spec so the platform is fully demonstrable offline.
 */

type Obs = { toolName: string; parameters: any; result: any };

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

function extractMeetingTitle(msg: string): string {
  let t = msg
    .replace(/\band (notify|inform|tell|ping|message)\b.*$/i, '')
    .replace(/\b(schedule|set up|book|arrange|create)\b/gi, '')
    .replace(/\b(a|an|the)\b/gi, '')
    .replace(/\b(tomorrow'?s?|today'?s?|day after tomorrow|next \w+|on \w+day|\w+day'?s?)\b/gi, '')
    .replace(/\bat \d{1,2}(:\d{2})?\s*(am|pm)?/gi, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const withMatch = t.match(/meeting with (.+)/i);
  if (withMatch) t = `Meeting with ${withMatch[1]}`;
  t = t.replace(/^meeting$/i, '').trim();
  if (!t) return 'Team meeting';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function extractChannel(msg: string): string | undefined {
  return msg.match(/#[\w-]+/)?.[0];
}

function extractSearchQuery(msg: string): string {
  const m = msg.match(/(?:related to|about|regarding|for|on|named|called)\s+(.+?)[?.!]*$/i);
  if (m) return m[1].trim();
  return msg.replace(/\b(find|search|show|look up|get|me|all|documents?|files?|anything|everything)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function isEmailList(result: any): result is any[] {
  return Array.isArray(result) && result.length >= 0 && (result.length === 0 || result[0]?.subject !== undefined);
}

function emailHeadline(emails: any[]) {
  const c: Record<string, number> = {};
  emails.forEach((e) => (c[e.category || 'Normal'] = (c[e.category || 'Normal'] || 0) + 1));
  const parts = [`${emails.length} emails`];
  if (c['Urgent']) parts.push(`${c['Urgent']} urgent`);
  if (c['Bug/Issue']) parts.push(`${c['Bug/Issue']} bug reports`);
  if (c['Meeting']) parts.push(`${c['Meeting']} meeting invitations`);
  if (c['Client Request']) parts.push(`${c['Client Request']} client requests`);
  if (c['Important']) parts.push(`${c['Important']} important`);
  return parts.join(' • ');
}

export function heuristicAgentStep(message: string, observations: Obs[]): AgentStepResult {
  const q = message.toLowerCase();
  const wantsJira = has(q, 'jira', 'ticket', 'task');
  const wantsSlack = has(q, 'slack', 'notify', 'inform', 'tell the team', 'ping');

  // ---------- second pass: we already have data, compose an answer / follow-up actions
  if (observations.length > 0) {
    const last = observations[observations.length - 1];
    const result = last.result;

    if (isEmailList(result) && last.toolName.startsWith('gmail')) {
      const emails = result as any[];
      const headline = emailHeadline(emails);
      const lines = emails.slice(0, 8).map((e) => `• [${e.priority || '—'}] ${e.subject} — ${e.senderName || e.sender}`);
      const bugs = emails.filter((e) => e.category === 'Bug/Issue' || e.category === 'Urgent');
      const toolCalls: AgentStepResult['toolCalls'] = [];
      const alreadyProposed = observations.some((o) => o.toolName === 'jira_create_issue');
      if (wantsJira && !alreadyProposed) {
        bugs.slice(0, 5).forEach((e) =>
          toolCalls.push({
            toolName: 'jira_create_issue',
            parameters: {
              summary: e.subject.replace(/^(urgent:|bug report:)\s*/i, '').slice(0, 200),
              description: `${e.summary || e.snippet || ''}\n\nReported by: ${e.sender}\nGmail message: ${e.messageId}`,
              issueType: 'Bug',
              priority: e.priority === 'High' ? 'High' : 'Medium',
            },
            confirmationPrompt: `Create Jira bug "${e.subject.slice(0, 80)}"`,
          })
        );
      }
      if (wantsSlack) {
        toolCalls.push({
          toolName: 'slack_send_message',
          parameters: { channel: extractChannel(message) || env.SLACK_DEFAULT_CHANNEL, message: `:inbox_tray: Inbox digest — ${headline}\n${lines.slice(0, 5).join('\n')}` },
          confirmationPrompt: 'Post the inbox digest to Slack',
        });
      }
      return {
        intent: wantsJira ? 'summarize_and_create_tickets' : 'summarize_emails',
        replyMessage: `${headline}\n\n${lines.join('\n') || 'No emails matched.'}${
          toolCalls.length ? `\n\nI prepared ${toolCalls.length} action(s) for your approval below.` : bugs.length ? `\n\n${bugs.length} of these look like bugs — ask me to "create Jira tasks for the bugs" to file them.` : ''
        }`,
        toolCalls,
        isSimulated: true,
      };
    }

    if (last.toolName === 'jira_search_issues') {
      const issues = (result?.issues || []) as any[];
      return {
        intent: 'list_jira_tasks',
        replyMessage: issues.length
          ? `You have ${issues.length} pending Jira issues:\n${issues.slice(0, 10).map((i) => `• ${i.key} [${i.status}] ${i.summary}${i.assignee ? ` — ${i.assignee}` : ''}`).join('\n')}`
          : 'No pending Jira issues found.',
        toolCalls: [],
        isSimulated: true,
      };
    }

    if (last.toolName === 'smart_search') {
      const results = (result?.results || []) as any[];
      return {
        intent: 'smart_search',
        replyMessage: `${result?.summary || `Found ${results.length} results.`}\n\n${results.slice(0, 8).map((r) => `• [${r.source}] ${r.title}`).join('\n')}`,
        toolCalls: [],
        isSimulated: true,
      };
    }

    if (last.toolName === 'github_list_pull_requests') {
      const prs = (result?.pullRequests || []) as any[];
      return {
        intent: 'list_pull_requests',
        replyMessage: prs.length ? `Open pull requests:\n${prs.map((p) => `• #${p.number} ${p.title} (${p.author})`).join('\n')}` : 'No open pull requests.',
        toolCalls: [],
        isSimulated: true,
      };
    }

    const summary = result?.summary || result?.message || result?.headline;
    return {
      intent: 'tool_result',
      replyMessage: summary ? String(summary) : `Done. ${last.toolName} returned results — see the details below.`,
      toolCalls: [],
      isSimulated: true,
    };
  }

  // ---------- first pass: decide which tools to call
  if (has(q, 'schedule', 'book a meeting', 'set up a meeting', 'arrange')) {
    const when = parseNaturalDateTime(message) || parseNaturalDateTime('tomorrow at 10am')!;
    const title = extractMeetingTitle(message);
    const calls: AgentStepResult['toolCalls'] = [
      {
        toolName: 'calendar_create_event',
        parameters: { summary: title, start: when.local, end: addMinutesLocal(when.local, 60), attendees: [] },
        confirmationPrompt: `Create calendar event "${title}" at ${when.local.replace('T', ' ').slice(0, 16)}`,
      },
    ];
    if (wantsSlack) {
      calls.push({
        toolName: 'slack_send_message',
        parameters: { channel: extractChannel(message) || env.SLACK_DEFAULT_CHANNEL, message: `:calendar: *${title}* is scheduled for ${when.local.replace('T', ' ').slice(0, 16)} (${env.APP_TIMEZONE}). Please join!` },
        confirmationPrompt: 'Notify the team on Slack',
      });
    }
    return { intent: 'schedule_meeting', replyMessage: `I'll schedule "${title}" and ${wantsSlack ? 'notify the team on Slack' : 'add it to your calendar'}. Please confirm below.`, toolCalls: calls, isSimulated: true };
  }

  if (has(q, 'jira') && has(q, 'pending', 'open', 'show', 'list', 'my')) {
    return { intent: 'list_jira_tasks', replyMessage: 'Fetching your pending Jira tasks…', toolCalls: [{ toolName: 'jira_search_issues', parameters: { jql: 'statusCategory != Done ORDER BY priority DESC, updated DESC', maxResults: 15 } }], isSimulated: true };
  }

  if (has(q, 'sprint')) {
    return { intent: 'sprint_analytics', replyMessage: 'Pulling sprint analytics…', toolCalls: [{ toolName: 'jira_sprint_analytics', parameters: {} }], isSimulated: true };
  }

  if (has(q, 'slack') && has(q, 'summar', 'catch up', 'what happened')) {
    return { intent: 'summarize_slack', replyMessage: 'Summarizing the channel…', toolCalls: [{ toolName: 'slack_summarize_channel', parameters: { channel: extractChannel(message) || env.SLACK_DEFAULT_CHANNEL } }], isSimulated: true };
  }

  if (has(q, 'pull request', ' prs', 'pr ')) {
    return { intent: 'list_pull_requests', replyMessage: 'Fetching pull requests…', toolCalls: [{ toolName: 'github_list_pull_requests', parameters: { state: 'open' } }], isSimulated: true };
  }

  if (has(q, 'repo') && has(q, 'analytic', 'stats', 'insight')) {
    return { intent: 'repo_analytics', replyMessage: 'Collecting repository analytics…', toolCalls: [{ toolName: 'github_repo_analytics', parameters: {} }], isSimulated: true };
  }

  if (has(q, 'calendar', 'my meetings', 'free', 'availability', 'busy')) {
    return { intent: 'list_events', replyMessage: 'Checking your calendar…', toolCalls: [{ toolName: 'calendar_list_events', parameters: { days: 7 } }], isSimulated: true };
  }

  if (has(q, 'find', 'search', 'document', 'look up') && !has(q, 'email', 'inbox', 'mail')) {
    return { intent: 'smart_search', replyMessage: 'Searching across your workspace…', toolCalls: [{ toolName: 'smart_search', parameters: { query: extractSearchQuery(message) } }], isSimulated: true };
  }

  if (has(q, 'summar', 'unread', 'digest', 'inbox', "today's email", 'todays email')) {
    return { intent: 'summarize_unread_emails', replyMessage: 'Reading your unread emails…', toolCalls: [{ toolName: 'gmail_fetch_unread', parameters: { maxResults: 15 } }], isSimulated: true };
  }

  if (has(q, 'bug', 'issue', 'error', 'outage', 'incident')) {
    return { intent: 'find_bug_reports', replyMessage: 'Searching your inbox for bug reports…', toolCalls: [{ toolName: 'gmail_search', parameters: { query: 'bug OR error OR incident OR outage OR failing', maxResults: 10 } }], isSimulated: true };
  }

  if (has(q, 'urgent', 'important', 'priority')) {
    return { intent: 'find_urgent_emails', replyMessage: 'Finding urgent and important emails…', toolCalls: [{ toolName: 'gmail_search', parameters: { query: 'is:important', maxResults: 10 } }], isSimulated: true };
  }

  if (has(q, 'email', 'inbox', 'unread', 'summar', 'mail', 'today')) {
    return { intent: 'summarize_unread_emails', replyMessage: 'Reading your unread emails…', toolCalls: [{ toolName: 'gmail_fetch_unread', parameters: { maxResults: 15 } }], isSimulated: true };
  }

  return {
    intent: 'help',
    replyMessage:
      'I can work across Gmail, Slack, Jira, GitHub, Google Drive, Calendar and Notion. Try:\n• "Summarize today\'s emails and create Jira tasks for bugs"\n• "Schedule tomorrow\'s sprint planning at 11 AM and notify everyone on Slack"\n• "Show pending Jira tasks"\n• "Find documents related to Project Alpha"\n• "Summarize #engineering on Slack"',
    toolCalls: [],
    isSimulated: true,
  };
}
