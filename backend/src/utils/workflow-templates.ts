import { IWorkflow } from '../models/workflow.model';

/**
 * Built-in workflow templates. Step `config` values support {{templates}} resolved against:
 *   trigger.*   data from the trigger (webhook payload, new email, sample data for manual runs)
 *   steps.<id>  output of an earlier step            emails  the current email list
 *   item        current element inside a forEach step  user.email / user.name  the running user
 *   now / today current local date-time / date        {{a ?? b}} uses b when a is empty
 */
const SAMPLE_TRANSCRIPT = `Sprint 14 planning — attendees: Priya, Rahul, Ankit, Sneha.
Priya: Sprint goal is shipping the Slack digest and fixing webhook 401s.
Rahul: I will finish the OAuth token refresh fix by Friday.
Ankit: Dashboard analytics page needs design review; I will share Figma by Wednesday.
Sneha: QA needs a staging build before Thursday for regression.
Priya: We decided to postpone the Notion knowledge base to next sprint.
Rahul: Action: write the RCA for the 401 incident by 2026-11-28.
Ankit: Will pair with Sneha on end-to-end tests next week.`;

export const WORKFLOW_TEMPLATES: Array<Partial<IWorkflow>> = [
  {
    title: 'Email Intelligence Digest',
    description: 'Fetches unread Gmail, analyses each email with Gemini (summary, category, priority), builds an executive digest and alerts Slack when something urgent arrives.',
    category: 'email_intelligence',
    trigger: { type: 'manual', provider: 'gmail', config: {} },
    steps: [
      { id: 'fetch', name: 'Fetch unread emails', type: 'action', provider: 'gmail', tool: 'gmail_fetch_unread', config: { maxResults: 10 }, order: 1 },
      { id: 'digest', name: 'AI executive digest', type: 'ai', provider: 'gemini', tool: 'ai_summarize_emails', config: {}, order: 2 },
      { id: 'urgent', name: 'Detect urgent emails', type: 'ai', provider: 'gemini', tool: 'ai_detect_urgent', config: {}, order: 3 },
      {
        id: 'alert',
        name: 'Alert Slack if urgent',
        type: 'notification',
        provider: 'slack',
        tool: 'slack_send_message',
        condition: { path: 'steps.urgent.urgentCount', operator: 'gt', value: 0 },
        config: { channel: '{{trigger.channel}}', message: ':rotating_light: *{{steps.urgent.urgentCount}} email(s) need attention*\n{{steps.digest.headline}}\n\n{{steps.digest.summary}}' },
        order: 4,
      },
      { id: 'save', name: 'Save digest', type: 'storage', provider: 'system', tool: 'system_save_digest', config: { note: '{{steps.digest.headline}}' }, order: 5 },
    ],
  },
  {
    title: 'Client Email → Jira → Slack → Meeting → Notion',
    description: 'Spec workflow 1: a client bug email is summarised, turned into a Jira ticket, the team is notified on Slack, a triage meeting is scheduled and the incident is documented in Notion.',
    category: 'customer_support',
    trigger: { type: 'manual', provider: 'gmail', config: { query: 'bug OR error OR outage OR failing' } },
    steps: [
      { id: 'find', name: 'Find client bug emails', type: 'action', provider: 'gmail', tool: 'gmail_search', config: { query: '{{trigger.query ?? bug OR error OR outage OR failing}}', maxResults: 3 }, order: 1 },
      { id: 'bugs', name: 'AI extracts bug details', type: 'ai', provider: 'gemini', tool: 'ai_extract_bug_details', config: {}, order: 2 },
      {
        id: 'jira',
        name: 'Create Jira ticket per bug',
        type: 'action',
        provider: 'jira',
        tool: 'jira_create_issue',
        forEach: 'steps.bugs.bugs',
        config: { summary: '{{item.title}}', description: '{{item.description}}', issueType: 'Bug', priority: '{{item.jiraPriority}}', labels: ['client-reported', 'autoflow'] },
        order: 3,
      },
      {
        id: 'notify',
        name: 'Notify engineering on Slack',
        type: 'notification',
        provider: 'slack',
        tool: 'slack_send_message',
        condition: { path: 'steps.bugs.bugCount', operator: 'gt', value: 0 },
        config: { channel: '{{trigger.channel}}', message: ':bug: Client issue: *{{steps.bugs.firstBug.title}}* ({{steps.bugs.firstBug.severity}})\nJira: {{steps.jira.first.key}} {{steps.jira.first.url}}' },
        order: 4,
      },
      {
        id: 'meeting',
        name: 'Schedule triage meeting',
        type: 'action',
        provider: 'calendar',
        tool: 'calendar_create_event',
        condition: { path: 'steps.bugs.bugCount', operator: 'gt', value: 0 },
        config: { summary: 'Triage: {{steps.bugs.firstBug.title}}', start: '{{trigger.meetingTime ?? tomorrow at 11am}}', durationMinutes: 30, description: 'Auto-scheduled by AutoFlow AI.\nJira: {{steps.jira.first.key}}' },
        order: 5,
      },
      {
        id: 'doc',
        name: 'Document incident in Notion',
        type: 'storage',
        provider: 'notion',
        tool: 'notion_create_page',
        condition: { path: 'steps.bugs.bugCount', operator: 'gt', value: 0 },
        config: { title: 'Incident: {{steps.bugs.firstBug.title}}', content: '## Summary\n{{steps.bugs.firstBug.description}}\n\n## Tracking\n- Jira: {{steps.jira.first.key}}\n- Triage meeting: {{steps.meeting.event.start}}\n- Logged: {{now}}' },
        order: 6,
      },
    ],
  },
  {
    title: 'GitHub PR Merged → Release Notes → Notion → Slack → Email',
    description: 'Spec workflow 2: when a pull request is merged, AI writes release notes, publishes them to Notion, announces on Slack and emails stakeholders.',
    category: 'devops',
    trigger: { type: 'github_pr_merged', provider: 'github', config: { repo: '', sampleData: { repo: '', number: 212, title: 'Add Slack Block Kit digest formatter' } } },
    steps: [
      { id: 'notes', name: 'AI release notes', type: 'ai', provider: 'github', tool: 'github_generate_release_notes', config: { repo: '{{trigger.repo}}', number: '{{trigger.number}}' }, order: 1 },
      { id: 'notion', name: 'Publish to Notion', type: 'storage', provider: 'notion', tool: 'notion_create_page', config: { title: '{{steps.notes.title}}', content: '{{steps.notes.markdown}}\n\nSource: {{steps.notes.url}}' }, order: 2 },
      { id: 'slack', name: 'Announce on Slack', type: 'notification', provider: 'slack', tool: 'slack_send_message', config: { channel: '{{trigger.channel}}', message: ':rocket: *{{steps.notes.title}}*\n{{steps.notes.markdown}}\nNotion: {{steps.notion.url}}' }, order: 3 },
      { id: 'email', name: 'Email stakeholders', type: 'notification', provider: 'gmail', tool: 'gmail_send_message', config: { to: '{{trigger.stakeholders ?? user.email}}', subject: '{{steps.notes.title}}', body: '{{steps.notes.markdown}}\n\nPR: {{steps.notes.url}}\nNotion: {{steps.notion.url}}' }, order: 4 },
    ],
  },
  {
    title: 'Meeting Completed → Summary → Action Items → Reminders → Jira',
    description: 'Spec workflow 3: meeting notes are summarised, action items extracted, calendar reminders created for due dates and Jira tasks assigned.',
    category: 'meeting_assistant',
    trigger: { type: 'manual', provider: 'system', config: { sampleData: { title: 'Sprint 14 Planning', attendees: ['priya@company.com', 'rahul@company.com'], transcript: SAMPLE_TRANSCRIPT } } },
    steps: [
      { id: 'meeting', name: 'AI meeting summary & action items', type: 'ai', provider: 'gemini', tool: 'ai_analyze_meeting', config: { title: '{{trigger.title}}', transcript: '{{trigger.transcript}}', attendees: '{{trigger.attendees}}' }, order: 1 },
      { id: 'notes', name: 'Save notes to Notion', type: 'storage', provider: 'notion', tool: 'notion_create_page', config: { title: 'Meeting notes — {{trigger.title}} ({{today}})', content: '{{steps.meeting.markdown}}' }, order: 2 },
      { id: 'reminders', name: 'Calendar reminders for deadlines', type: 'action', provider: 'calendar', tool: 'calendar_create_reminder', forEach: 'steps.meeting.actionItemsWithDates', config: { title: '{{item.task}}', dueDate: '{{item.dueDate}}', description: 'Owner: {{item.owner ?? unassigned}} — from {{trigger.title}}' }, order: 3 },
      { id: 'jira', name: 'Create Jira tasks', type: 'action', provider: 'jira', tool: 'jira_create_issue', forEach: 'steps.meeting.actionItems', config: { summary: '{{item.task}}', description: 'From meeting "{{trigger.title}}"\nOwner: {{item.owner ?? unassigned}}\nDue: {{item.dueDate ?? not set}}', issueType: 'Task', assignee: '{{item.owner}}', priority: 'Medium' }, order: 4 },
      { id: 'share', name: 'Share summary on Slack', type: 'notification', provider: 'slack', tool: 'slack_send_message', config: { channel: '{{trigger.channel}}', message: ':memo: *{{trigger.title}}* summary\n{{steps.meeting.summary}}\nNotes: {{steps.notes.url}} • {{steps.jira.count}} Jira task(s) created' }, order: 5 },
    ],
  },
  {
    title: 'Invoice Received → Drive → Finance → Approval Task',
    description: 'Intelligent suggestion workflow: invoices with attachments are saved to Drive/Invoices, finance is notified on Slack and an approval task is created.',
    category: 'task_automation',
    trigger: { type: 'manual', provider: 'gmail', config: {} },
    steps: [
      { id: 'find', name: 'Find invoice emails', type: 'action', provider: 'gmail', tool: 'gmail_search', config: { query: '{{trigger.query ?? invoice}}', maxResults: 5 }, order: 1 },
      { id: 'save', name: 'Save attachments to Drive', type: 'storage', provider: 'drive', tool: 'drive_save_attachment', forEach: 'emails', config: { messageId: '{{item.messageId}}', folderName: 'Invoices' }, order: 2 },
      { id: 'finance', name: 'Notify finance', type: 'notification', provider: 'slack', tool: 'slack_send_message', condition: { path: 'emails.0', operator: 'exists' }, config: { channel: '{{trigger.channel}}', message: ':receipt: New invoice: *{{emails.0.subject}}* from {{emails.0.sender}}. Saved to Drive/Invoices.' }, order: 3 },
      { id: 'approval', name: 'Create approval task', type: 'action', provider: 'jira', tool: 'jira_create_issue', forEach: 'emails', config: { summary: 'Approve: {{item.subject}}', description: '{{item.summary}}\nFrom: {{item.sender}}', issueType: 'Task', priority: 'Medium', labels: ['finance', 'invoice'] }, order: 4 },
    ],
  },
  {
    title: 'Daily Stand-up Briefing',
    description: 'Every morning: pending Jira issues, open pull requests and today\'s meetings are compiled into one briefing and posted to Slack.',
    category: 'task_automation',
    trigger: { type: 'schedule', provider: 'system', config: { intervalMinutes: 1440 } },
    steps: [
      { id: 'jira', name: 'Pending Jira issues', type: 'action', provider: 'jira', tool: 'jira_search_issues', config: { maxResults: 10 }, order: 1 },
      { id: 'prs', name: 'Open pull requests', type: 'action', provider: 'github', tool: 'github_list_pull_requests', config: { state: 'open' }, continueOnError: true, order: 2 },
      { id: 'cal', name: "Today's meetings", type: 'action', provider: 'calendar', tool: 'calendar_list_events', config: { days: 1 }, order: 3 },
      { id: 'text', name: 'Compose briefing', type: 'ai', provider: 'system', tool: 'system_compose_text', config: { text: ':sunrise: *Stand-up briefing — {{today}}*\n• Jira: {{steps.jira.issues.length}} open issues (top: {{steps.jira.issues.0.key}} {{steps.jira.issues.0.summary}})\n• GitHub: {{steps.prs.pullRequests.length}} open PRs\n• Calendar: {{steps.cal.events.length}} meetings today' }, order: 4 },
      { id: 'post', name: 'Post to Slack', type: 'notification', provider: 'slack', tool: 'slack_send_message', config: { channel: '{{trigger.channel}}', message: '{{steps.text.text}}' }, order: 5 },
    ],
  },
];
