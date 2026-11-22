/**
 * All LLM prompts in one place. Each prompt asks for strict JSON that is validated with Zod
 * in ai.service.ts — invalid output falls back to deterministic heuristics.
 */

const CATEGORIES = `- Important: leadership, compliance, finance or legal matters needing attention
- Urgent: production outages, blockers, time-critical escalations
- Bug/Issue: software bugs, errors, defects, failures
- Client Request: feature asks, renewals, pricing, documents requested by a client
- Meeting: invites, scheduling, syncs
- Normal: routine business correspondence
- Promotional: marketing, newsletters, event promotions`;

export const emailSummaryPrompt = (subject: string, body: string, sender: string) => `You are an executive assistant.
Summarize this email.

Sender: ${sender}
Subject: ${subject}
Body:
"""${body.slice(0, 8000)}"""

Return JSON: {"summary": "2-3 sentences", "keyPoints": ["...", "..."], "importantInformation": "deadline/blocker or empty string"}`;

export const emailClassificationPrompt = (subject: string, body: string, sender: string) => `Classify this email into exactly one category:
${CATEGORIES}

Sender: ${sender}
Subject: ${subject}
Body:
"""${body.slice(0, 6000)}"""

Return JSON: {"category": "<one of the categories>", "priority": "High|Medium|Low", "confidence": 0.0-1.0, "reasoning": "one sentence"}`;

export const emailReplyPrompt = (subject: string, body: string, sender: string, instruction?: string) => `Draft a concise, professional reply to this email.
${instruction ? `User guidance: ${instruction}` : 'Tone: professional, courteous, proactive.'}
Do not invent facts, attachments, or commitments that the email does not support.

From: ${sender}
Subject: ${subject}
Body:
"""${body.slice(0, 6000)}"""

Return JSON: {"subject": "Re: ...", "body": "full reply text with greeting and sign-off", "tone": "Professional"}`;

export const fullEmailAnalysisPrompt = (subject: string, body: string, sender: string) => `You are the AI triage engine of an enterprise workflow automation platform.
Analyse the email and return ONE JSON object.

Categories:
${CATEGORIES}

Available automation tools you can suggest (use exact names):
jira_create_issue, github_create_issue, slack_send_message, calendar_create_event, drive_save_attachment, notion_create_page, gmail_send_message

From: ${sender}
Subject: ${subject}
Body:
"""${body.slice(0, 8000)}"""

Return JSON:
{
  "summary": "2-3 sentence executive summary",
  "keyPoints": ["3-5 short bullets"],
  "category": "<category>",
  "priority": "High|Medium|Low",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence",
  "recommendedAction": "single most useful next step",
  "actionType": "create_task|send_reply|schedule_meeting|investigate_incident|archive|none",
  "suggestedReply": "short professional reply draft, or empty string for promotional mail",
  "suggestedActions": [{"label": "e.g. Save invoice to Drive", "tool": "drive_save_attachment", "reason": "why"}]
}`;

export const bugDetailsPrompt = (subject: string, body: string) => `Extract a structured bug report from this message.
Subject: ${subject}
Body:
"""${body.slice(0, 6000)}"""

Return JSON: {"title": "short bug title", "severity": "Critical|High|Medium|Low", "component": "affected area",
"stepsToReproduce": ["..."], "expectedBehavior": "...", "actualBehavior": "...", "environment": "prod/staging/unknown"}`;

export const digestPrompt = (items: string) => `Write an executive inbox digest for these emails.
${items}

Return JSON: {"headline": "one line, e.g. '12 unread • 3 urgent • 2 meetings'", "summary": "3-5 sentence briefing that names the most important items first", "topPriorities": ["..."]}`;

export const releaseNotesPrompt = (pr: string) => `Write release notes for this merged pull request. Use markdown with sections
"## What's new", "## Fixes", "## Notes" (omit empty sections). Keep it under 200 words.

${pr}

Return JSON: {"title": "Release notes title", "markdown": "...", "highlights": ["..."]}`;

export const prSummaryPrompt = (pr: string) => `Review this pull request and summarize it for a tech lead.
${pr}

Return JSON: {"summary": "2-3 sentences", "keyChanges": ["..."], "risk": "Low|Medium|High", "reviewNotes": ["..."]}`;

export const meetingAnalysisPrompt = (title: string, attendees: string[], transcript: string, today: string) => `You are a meeting assistant. Today is ${today}.
Analyse these meeting notes / transcript.

Meeting: ${title}
Invited: ${attendees.join(', ') || 'unknown'}
Notes:
"""${transcript.slice(0, 12000)}"""

Return JSON:
{"summary": "4-6 sentence summary",
 "decisions": ["..."],
 "actionItems": [{"task": "...", "owner": "name or email if mentioned", "dueDate": "YYYY-MM-DD if a date is stated or clearly implied, else empty"}],
 "deadlines": ["..."],
 "attendance": ["people who actually spoke or are mentioned as present"]}`;

export const agendaPrompt = (title: string, attendees: string[], context: string) => `Create a focused meeting agenda.
Meeting: ${title}
Attendees: ${attendees.join(', ') || 'team'}
Context: ${context || 'none'}

Return JSON: {"agenda": ["5-7 agenda items with rough time boxes, e.g. '10 min — Sprint goal review'"]}`;

export const conversationSummaryPrompt = (channel: string, messages: string) => `Summarize this Slack conversation from ${channel}.
${messages}

Return JSON: {"summary": "3-4 sentences", "keyPoints": ["..."], "actionItems": ["..."]}`;

export const priorityPrompt = (text: string) => `Decide the engineering priority of this issue.
"""${text.slice(0, 3000)}"""
Return JSON: {"priority": "Highest|High|Medium|Low", "reason": "one sentence"}`;

export const ragAnswerPrompt = (question: string, context: string) => `Answer the question using ONLY the context passages below.
Cite passages inline like [1], [2]. If the context does not contain the answer, say so plainly.

Question: ${question}

Context:
${context}

Return JSON: {"answer": "...", "citations": [1, 2]}`;

export const searchSummaryPrompt = (query: string, results: string) => `The user searched their workspace for: "${query}".
Results from Gmail, Drive, Jira, GitHub, Notion and the knowledge base:
${results}

Return JSON: {"summary": "2-4 sentences telling the user what was found and which items look most relevant"}`;

export const agentPrompt = (params: {
  message: string;
  history: string;
  tools: string;
  observations: string;
  now: string;
  timezone: string;
}) => `You are AutoFlow AI, an enterprise workflow assistant connected to Gmail, Slack, Google Drive,
Google Calendar, GitHub, Jira and Notion. You act by calling tools.

Current date/time: ${params.now} (${params.timezone})

TOOLS (name: description | params):
${params.tools}

RULES
1. Plan the minimum tool calls needed. You may call several tools in one step.
2. Read-only tools run immediately. Tools marked [CONFIRM] change external systems (send, create, post, schedule);
   they are shown to the user for approval — still call them when the user asked for that action.
3. When an action depends on data you have not fetched yet (e.g. "create Jira tasks for bug emails"),
   first call the read tool. You will receive its results as OBSERVATIONS and can then call the write tools.
4. Use ISO 8601 local date-times (YYYY-MM-DDTHH:mm:ss) for calendar times, resolved against the current date.
5. When OBSERVATIONS already answer the request, return "toolCalls": [] and a replyMessage that answers with
   concrete numbers and names (e.g. "12 unread emails: 3 urgent, 2 meeting invites, 1 client complaint").
6. Never invent tool names or results.

CONVERSATION SO FAR:
${params.history || '(none)'}

USER REQUEST: "${params.message}"

OBSERVATIONS FROM TOOLS ALREADY RUN THIS TURN:
${params.observations || '(none yet)'}

Return JSON:
{"intent": "short_snake_case", "replyMessage": "what you tell the user", "toolCalls": [{"toolName": "...", "parameters": {}, "confirmationPrompt": "for [CONFIRM] tools: what will happen"}]}`;
