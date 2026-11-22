# AutoFlow AI — Enterprise AI Workflow Automation Platform

AutoFlow AI connects **Gmail, Slack, Google Drive, Google Calendar, GitHub, Jira and Notion** and lets people automate work with natural language ("Summarize today's emails and create Jira tasks for bugs") or with multi-step workflows ("Client email → Jira ticket → Slack alert → triage meeting → Notion incident page").

> **First time?** Follow [`SETUP_GUIDE.md`](./SETUP_GUIDE.md) — it walks through every API key and the full local setup.

---

## Features (mapped to the project specification)

| Spec item | Implementation |
|---|---|
| **Gmail** — read, search, send, summarise, auto-reply, urgency, attachments, classify | `services/gmail`, tools `gmail_*`, Email Intelligence page, attachment download + “Save to Drive” |
| **Slack** — send, read channels, AI summaries, mentions, reminders, notify | `services/slack`, tools `slack_send_message` (mentions by email / @channel), `slack_read_channel`, `slack_summarize_channel`, `slack_schedule_message` |
| **Google Drive** — upload, download, AI search & summaries, organise folders, PDF text | `services/google/drive.service.ts`, tools `drive_*`, PDF/Docs/Sheets text extraction |
| **Google Calendar** — schedule, availability, conflict detection, reminders | `services/google/calendar.service.ts`, free/busy + overlap detection, natural-language times, Meet links |
| **GitHub** — repos, issues, AI PR summaries, analytics, commits, releases | `services/github`, tools `github_*`, PR-merged webhook |
| **Jira** — create, update status, assign, sprint analytics, AI priority | `services/jira` (REST v3 + Agile API), `priority: "auto"` uses Gemini |
| **Notion** — pages, meeting notes, docs, daily reports | `services/notion` (markdown → Notion blocks) |
| **AI chat assistant** | Multi-step agent loop (plan → run read tools → observe → propose write actions) with approval cards |
| **Email summarisation / workflow suggestions** | One Gemini call per email: summary, category, priority, recommended action, reply draft, suggested tool actions (e.g. invoice → Drive + finance + approval task) |
| **Task automation & 3 example workflows** | Workflow engine with templates, `forEach`, conditions, schedule / Gmail / webhook / GitHub triggers. Spec workflows 1–3 ship as templates |
| **AI meeting assistant** | Agenda generation, notes → summary, decisions, action items, deadlines, attendance → Notion / Calendar reminders / Jira / Slack |
| **Smart search** | One query across Gmail, Drive, Jira, GitHub, Notion and the knowledge base, with an AI summary |
| **RAG** | Upload PDFs/text or import Drive/Notion docs → chunk → Gemini embeddings → cosine retrieval → cited answers |
| **Security** | JWT auth, bcrypt passwords, RBAC (admin / manager / user), rate limiting, Helmet headers, AES-256-GCM encrypted tokens, audit log with secret redaction, confirmation guard for every external write |
| **Logs / analytics dashboard** | Execution logs per step, audit trail, dashboard metrics computed from real records |

**Demo mode:** any integration you have not connected returns clearly-labelled *simulated* data, so the whole product can be demonstrated before every key is configured. Without `GEMINI_API_KEY`, AI features fall back to deterministic heuristics (also labelled).

---

## Architecture

```
 Browser ──► Next.js 14 (React, Tailwind)  ──/api proxy──►  Express API (TypeScript)
                                                              │
                         ┌────────────────────────────────────┼─────────────────────────────┐
                         │                                    │                             │
                 AI Assistant agent                 Workflow engine                 REST controllers
              (plan → tools → observe)       (templates, forEach, conditions,       (auth, gmail, search,
                         │                     triggers, scheduler, webhooks)         meetings, admin…)
                         └──────────────┬─────────────────────┘
                                        ▼
                         Tool Registry + Confirmation Guard + Audit log
                                        │
      ┌──────────┬──────────┬───────────┼───────────┬──────────┬──────────┬───────────┐
    Gmail      Drive     Calendar     Slack        Jira      GitHub     Notion     Gemini (LLM,
  (Google OAuth — one grant)        (API tokens, AES-256 encrypted)                embeddings)
                                        │
                                    MongoDB (users, accounts, workflows, executions,
                                    logs, email analyses, conversations, meetings,
                                    knowledge chunks + vectors, audit log)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, lucide-react |
| Backend | Node.js 20, Express, TypeScript, Zod validation |
| AI | Google Gemini via `@google/genai` (generation + embeddings), custom agent loop, RAG |
| Data | MongoDB + Mongoose |
| Auth & security | JWT, bcryptjs, RBAC, express-rate-limit, Helmet, AES-256-GCM |
| Integrations | googleapis (Gmail/Drive/Calendar), Slack Web API, Jira Cloud REST v3 + Agile, GitHub REST, Notion API |
| Testing | Jest, ts-jest, Supertest (40 tests, run offline) |
| DevOps | Docker, Docker Compose |

## Project structure

```
backend/src
  config/        env + MongoDB connection
  controllers/   auth, gmail, ai, assistant, integrations/tools, workflows/webhooks, knowledge/search, meetings, analytics/admin
  middleware/    JWT auth + RBAC, rate limits, error handler, request logger
  models/        User, ConnectedAccount, Workflow, WorkflowExecution, ExecutionLog, EmailAnalysis,
                 AIConversation, Meeting, KnowledgeDocument/DocumentChunk, AuditLog
  routes/        all REST routes (index.ts)
  services/      ai (Gemini provider, prompts, agent fallback), gmail, google (OAuth, Drive, Calendar),
                 slack, jira, github, notion, integrations (credentials, demo data), knowledge (RAG),
                 search, workflows (engine, templates, scheduler), audit
  tools/         Tool registry + 52 tools (gmail, slack, jira, github, notion, drive, calendar, ai/system)
  utils/         crypto, natural-language dates, demo data, workflow templates, seed/migrations
backend/tests    api, health, ai, tools, workflows, utils
frontend/src
  app/           dashboard, login, assistant, emails, search, meetings, workflows, executions, integrations, settings
  components/    layout (AppShell, Sidebar, Topbar) + UI kit
  lib/           api client (JWT), auth context, utils
```

## Quick start

```bash
cp .env.example .env          # fill in at least MONGODB_URI, JWT_SECRET, ENCRYPTION_KEY
npm run install:all
npm run dev:backend           # http://localhost:5000/api/health
npm run dev:frontend          # http://localhost:3000  (login: admin@autoflow.ai / Admin@123)
npm test                      # 40 backend tests, no network needed
```

Docker: `docker compose up --build` (MongoDB + API + frontend).

## Main API endpoints

All routes except auth/login/register, the Google OAuth callback and webhooks need `Authorization: Bearer <JWT>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`, `GET /api/auth/google/url`, `GET /api/auth/google/callback` |
| Assistant | `POST /api/assistant/chat`, `POST /api/assistant/confirm-action`, `POST /api/assistant/reject-action`, `GET /api/assistant/sessions` |
| Gmail / AI | `GET /api/gmail/messages`, `GET /api/gmail/messages/:id/attachments/:aid`, `POST /api/gmail/send`, `POST /api/ai/analyze-email`, `POST /api/ai/analyze-batch`, `POST /api/ai/generate-reply` |
| Integrations | `GET /api/integrations`, `POST /api/integrations/:provider/connect`, `POST /api/integrations/:provider/test`, `DELETE /api/integrations/:provider` |
| Tools | `GET /api/tools`, `POST /api/tools/:name/execute` (`confirmed: true` required for writes) |
| Workflows | `GET/POST /api/workflows`, `PUT/DELETE /api/workflows/:id`, `POST /api/workflows/:id/duplicate`, `POST /api/workflows/:id/execute`, `GET /api/executions[/:id]` |
| Webhooks | `POST /api/webhooks/github`, `POST /api/webhooks/workflows/:id/:token` |
| Search / RAG | `GET /api/search?q=`, `GET/POST /api/knowledge…`, `POST /api/knowledge/ask` |
| Meetings | `GET/POST /api/meetings`, `POST /api/meetings/:id/notes`, `POST /api/meetings/:id/sync` |
| Admin | `GET /api/analytics/overview`, `GET /api/audit-logs`, `GET/PATCH /api/admin/users` (admin only) |

## Workflow template syntax

Step `config` values can reference earlier data:

- `{{trigger.repo}}` — trigger payload (webhook body, new email, or the template's sample data)
- `{{steps.<stepId>.field}}` — output of an earlier step (`{{steps.jira.first.key}}` after a `forEach` step)
- `{{emails}}`, `{{item.subject}}` (inside `forEach`), `{{user.email}}`, `{{today}}`, `{{now}}`
- `{{a ?? fallback}}` — fallback when `a` is empty

Steps can have `forEach: "steps.bugs.bugs"`, `condition: { path, operator: exists|gt|lt|eq|neq|contains, value }` and `continueOnError`.

## Future enhancements

Microsoft Teams / Outlook / Zoom / Salesforce / SAP connectors, BullMQ + Redis job queue for high-volume triggers, MongoDB Atlas Vector Search instead of in-process cosine similarity, voice input, multi-language UI, mobile app.
