import { env } from '../../config/env.config';
import { NotConnectedError } from './http';

/**
 * When a provider is not connected and DEMO_MODE=true, services return clearly-labelled
 * simulated data ({ simulated: true }) so the full product can be demonstrated offline.
 * With DEMO_MODE=false a NotConnectedError is thrown instead.
 */
export async function liveOrDemo<C, T>(
  provider: string,
  creds: C | null,
  live: (creds: C) => Promise<T>,
  demo: () => T
): Promise<T & { simulated?: boolean }> {
  if (creds) return (await live(creds)) as any;
  if (!env.DEMO_MODE) throw new NotConnectedError(provider);
  const d: any = demo();
  return (Array.isArray(d) ? Object.assign(d, { simulated: true }) : { ...d, simulated: true }) as any;
}

let counter = 140;
export const nextDemoId = () => ++counter;

export const DEMO_SLACK_CHANNELS = [
  { id: 'C0DEMO1', name: 'general', isMember: true, memberCount: 42 },
  { id: 'C0DEMO2', name: 'engineering', isMember: true, memberCount: 18 },
  { id: 'C0DEMO3', name: 'incident-response', isMember: true, memberCount: 9 },
  { id: 'C0DEMO4', name: 'finance', isMember: true, memberCount: 6 },
];

export const DEMO_SLACK_MESSAGES = [
  { user: 'Priya', text: 'Deploy of api-gateway v2.3 is done, monitoring error rates.', ts: '1' },
  { user: 'Rahul', text: 'Seeing a spike in 401s from the webhook service since 10:15 UTC.', ts: '2' },
  { user: 'Priya', text: 'Rolling back the auth middleware change, ETA 10 min.', ts: '3' },
  { user: 'Ankit', text: 'Can someone create a Jira ticket for the root-cause analysis?', ts: '4' },
  { user: 'Rahul', text: 'Rollback complete, 401s back to baseline. I will write the RCA by Friday.', ts: '5' },
];

export const DEMO_JIRA_ISSUES = [
  { key: 'AUTO-101', summary: 'Webhook auth returns 401 for enterprise tenants', status: 'In Progress', priority: 'Highest', assignee: 'Priya Sharma', issueType: 'Bug', updated: new Date().toISOString() },
  { key: 'AUTO-98', summary: 'Stream CSV export for >10k audit log rows', status: 'To Do', priority: 'High', assignee: 'Rahul Verma', issueType: 'Task', updated: new Date().toISOString() },
  { key: 'AUTO-95', summary: 'Add Notion meeting-notes template', status: 'To Do', priority: 'Medium', assignee: undefined, issueType: 'Story', updated: new Date().toISOString() },
  { key: 'AUTO-91', summary: 'Calendar conflict detection for recurring events', status: 'In Review', priority: 'Medium', assignee: 'Ankit Patil', issueType: 'Story', updated: new Date().toISOString() },
];

export const DEMO_GITHUB_REPOS = [
  { fullName: 'autoflow-ai/platform-api', description: 'Core workflow engine API', language: 'TypeScript', stars: 128, openIssues: 14, updatedAt: new Date().toISOString(), url: 'https://github.com' },
  { fullName: 'autoflow-ai/dashboard', description: 'Next.js enterprise dashboard', language: 'TypeScript', stars: 64, openIssues: 6, updatedAt: new Date().toISOString(), url: 'https://github.com' },
];

export const DEMO_PULL_REQUESTS = [
  { number: 212, title: 'Add Slack Block Kit digest formatter', author: 'priya-dev', state: 'open', url: 'https://github.com', createdAt: new Date().toISOString(), additions: 240, deletions: 31 },
  { number: 209, title: 'Fix: refresh Google OAuth tokens before expiry', author: 'rahul-v', state: 'open', url: 'https://github.com', createdAt: new Date().toISOString(), additions: 58, deletions: 12 },
];

export const DEMO_DRIVE_FILES = [
  { id: 'drv-demo-1', name: 'Project Alpha — Proposal v3.pdf', mimeType: 'application/pdf', modifiedTime: new Date().toISOString(), webViewLink: '#', owner: 'You' },
  { id: 'drv-demo-2', name: 'Project Alpha — Budget 2026', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: new Date().toISOString(), webViewLink: '#', owner: 'Finance' },
  { id: 'drv-demo-3', name: 'Sprint 14 Retrospective', mimeType: 'application/vnd.google-apps.document', modifiedTime: new Date().toISOString(), webViewLink: '#', owner: 'You' },
  { id: 'drv-demo-4', name: 'Invoices', mimeType: 'application/vnd.google-apps.folder', modifiedTime: new Date().toISOString(), webViewLink: '#', owner: 'You' },
];

export const DEMO_NOTION_PAGES = [
  { id: 'ntn-demo-1', title: 'Project Alpha — Architecture Notes', url: '#', lastEdited: new Date().toISOString() },
  { id: 'ntn-demo-2', title: 'Engineering Onboarding Handbook', url: '#', lastEdited: new Date().toISOString() },
  { id: 'ntn-demo-3', title: 'Sprint 14 Meeting Notes', url: '#', lastEdited: new Date().toISOString() },
];

export function demoCalendarEvents() {
  const day = (offset: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  return [
    { id: 'cal-demo-1', summary: 'Daily stand-up', start: day(0, 9, 30), end: day(0, 9, 45), attendees: ['team@company.com'], htmlLink: '#' },
    { id: 'cal-demo-2', summary: 'Client sync — Apex Capital', start: day(0, 15), end: day(0, 15, 30), attendees: ['marcus.vance@apexcapital.io'], htmlLink: '#' },
    { id: 'cal-demo-3', summary: 'Architecture review: Workflow Engine v2', start: day(1, 14), end: day(1, 15), attendees: ['elena.rostova@techcorp-global.com'], htmlLink: '#' },
  ];
}

export const DEMO_KNOWLEDGE_DOC = {
  title: 'Project Alpha — Proposal (demo)',
  text: `Project Alpha is an internal initiative to automate customer-support triage across Gmail, Jira and Slack.
Goal: reduce first-response time from 6 hours to under 30 minutes by Q2 2027.
Scope: AI classification of inbound email, automatic Jira bug creation with reproduction steps, Slack alerts to the on-call channel, and weekly Notion reports.
Budget: INR 18 lakh for FY 2026-27, covering cloud hosting (AWS), Gemini API usage and two contract engineers.
Timeline: Phase 1 (Gmail + Jira) by January 2027, Phase 2 (Slack + Calendar) by March 2027, Phase 3 (Notion knowledge base + RAG search) by May 2027.
Risks: OAuth verification for restricted Google scopes can take 4-6 weeks; Jira rate limits for bulk ticket creation; data privacy review for storing email bodies.
Owners: Priya Sharma (engineering lead), Rahul Verma (backend), Ankit Patil (frontend). Steering review every second Friday.
Success metrics: 80% of bug emails converted to tickets automatically, 95% classification accuracy on a labelled sample of 500 emails, under 2% false-urgent alerts.`,
};
