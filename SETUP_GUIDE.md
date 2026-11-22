# AutoFlow AI — Complete Setup Guide

This guide takes you from zero to a fully working project with every integration live. Follow the phases in order. Each phase has a time estimate and a **"Done when"** check, so you know it worked before you move on.

| Phase | What | Time |
|---|---|---|
| 0 | Security clean-up: rotate the leaked keys | 15 min |
| 1 | Install tools and run the project in demo mode | 30 min |
| 2 | Gemini API key (real AI) | 10 min |
| 3 | Google Cloud OAuth (Gmail + Drive + Calendar) | 45–60 min |
| 4 | Slack app | 20 min |
| 5 | Jira Cloud | 15 min |
| 6 | GitHub token + PR-merged webhook | 20 min |
| 7 | Notion integration | 10 min |
| 8 | End-to-end test and viva demo rehearsal | 60 min |

Total: about half a day. Phase 1 alone gives you a working demo, because every integration you haven't connected yet runs with clearly labelled simulated data.

---

## Phase 0 — Security clean-up (do this first)

The original `.env.example` in your zip contained **a real MongoDB Atlas username/password (`prathmesh`) and a Gemini API key**. Treat both as leaked, especially if the file was ever pushed to GitHub or shared.

1. **MongoDB Atlas:** go to Atlas → *Database Access*, then *Edit* user `prathmesh` and click *Edit Password*. Set a new password and update `MONGODB_URI` in your **private** `.env` only.
2. **Gemini:** go to https://aistudio.google.com/app/apikey, delete the old key and create a new one (Phase 2).
3. If the repo is on GitHub, the old values are still in the git history. Rotating them (steps 1–2) is the real fix; you don't need to rewrite history.
4. From now on, real secrets go only in `.env`, which `.gitignore` already excludes. `.env.example` holds placeholders only.

**Done when:** the old password no longer works and you have a new one saved privately.

---

## Phase 1 — Run the project locally (demo mode)

### 1.1 Install prerequisites
- **Node.js 20 LTS** (https://nodejs.org). Check with `node -v` (v20 or newer).
- **MongoDB**, pick one:
  - **A. MongoDB Atlas (easiest, free):** use your existing cluster with the new password. In Atlas → *Network Access*, add your current IP (or `0.0.0.0/0` for the demo only).
  - **B. Docker:** `docker run -d -p 27017:27017 --name mongo mongo:7` and use `MONGODB_URI=mongodb://localhost:27017/ai-workflow-automation`.
  - **C. MongoDB Community Server** installed locally (same URI as B).
- Git, and VS Code (recommended).

### 1.2 Configure
```bash
cd autoflow-ai
cp .env.example .env
```
Edit `.env`:
```env
# Atlas → your cluster → Connect → Drivers → copy the string, insert the NEW password and add the db name:
MONGODB_URI=mongodb+srv://<user>:<NEW_PASSWORD>@<your-cluster>.mongodb.net/ai-workflow-automation?retryWrites=true&w=majority
JWT_SECRET=<random string>
ENCRYPTION_KEY=<another random string>
```
Generate random strings with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
> Don't change `ENCRYPTION_KEY` after people have connected integrations. Their saved tokens would become unreadable and they'd have to reconnect.

### 1.3 Install and start
```bash
npm run install:all          # installs backend + frontend
npm test                     # 40 tests should pass (they need no network)
npm run dev:backend          # terminal 1 → http://localhost:5000/api/health
npm run dev:frontend         # terminal 2 → http://localhost:3000
```
Log in with **admin@autoflow.ai / Admin@123** (seeded on first start). Change the password under *Settings* right away.

**Done when:** `/api/health` shows `"database": "connected"`, you can log in, and the Emails page shows the 6 demo emails.

> Upgrading from the old version on the same Atlas database? On startup the backend drops the old global `messageId` index, removes v1 rows that had no owner, and replaces the old 3 workflow templates with the 6 new ones. This happens automatically.

---

## Phase 2 — Gemini API key (real AI)

1. Open https://aistudio.google.com/app/apikey, then *Create API key* (choose or create a Google Cloud project).
2. In `.env`:
   ```env
   GEMINI_API_KEY=<your key>
   GEMINI_MODEL=gemini-flash-latest
   ```
   `gemini-flash-latest` is an alias that always points to the current Flash model. If Google retires a model name, the code automatically tries `gemini-flash-latest`, `gemini-2.5-flash` and then `gemini-flash-lite-latest`. (The old code used `gemini-1.5-flash`, which has been shut down. That's why the AI never really worked before.)
3. Restart the backend. The startup log should say `AI: Gemini (gemini-flash-latest)` and the sidebar should show **Gemini connected**.

**Free-tier note:** the free tier allows only a limited number of requests per minute. The app keeps usage low: one Gemini call per email analysis, at most 3 in parallel, and one automatic retry on HTTP 429. If you see "AI rate limit reached", wait a minute.

**Done when:** on the Emails page, *Re-Analyze* on an email gives a summary **without** the "Heuristic analysis" label.

---

## Phase 3 — Google Cloud OAuth (Gmail + Drive + Calendar)

One Google sign-in gives the app access to all three services.

### 3.1 Create the project and enable the APIs
1. https://console.cloud.google.com → project selector → *New project* (e.g. `autoflow-ai`). You can reuse the Gemini project.
2. *APIs & Services → Library*, then enable **Gmail API**, **Google Drive API** and **Google Calendar API**.

### 3.2 OAuth consent screen (Google Auth Platform)
1. *APIs & Services → OAuth consent screen* (newer consoles call it *Google Auth Platform → Branding / Audience / Data access*).
2. User type: **External**. App name: `AutoFlow AI`. Fill in the support and developer email.
3. **Data access / Scopes:** add these scopes:
   - `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
   - `.../auth/gmail.readonly`, `.../auth/gmail.modify`, `.../auth/gmail.send`
   - `.../auth/drive.readonly`, `.../auth/drive.file`
   - `.../auth/calendar.events`, `.../auth/calendar.readonly`
4. **Audience → Test users:** add every Gmail address that will sign in (yours, your teammates', your guide's demo account). Leave the app in **Testing**. Gmail and Drive read scopes are "restricted", and publishing would need a Google security review, which a college project doesn't need.

> **Testing-mode gotcha:** Google expires refresh tokens for apps in Testing after **7 days**. If Gmail suddenly says "access expired", just click *Sign in with Google* again on the Integrations page. Reconnect the day before your viva.

### 3.3 Create OAuth credentials
1. *Credentials → Create credentials → OAuth client ID*, type **Web application**.
2. **Authorized JavaScript origins:** `http://localhost:3000`
3. **Authorized redirect URIs:** `http://localhost:5000/api/auth/google/callback` (it must match **exactly**, including the port)
4. Copy the Client ID and Client secret into `.env`:
   ```env
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
   ```
5. Restart the backend. In the app, go to **Integrations → Gmail → Sign in with Google**, approve all checkboxes, and you're redirected back.

**Done when:** Gmail, Google Drive and Google Calendar all show **CONNECTED**, the Emails page shows your real inbox (no "Demo inbox" badge), and *Analyse inbox* analyses it.

Common errors:
- `redirect_uri_mismatch`: the URI in Google Console doesn't exactly match `GOOGLE_REDIRECT_URI`.
- `access_denied` / "app not verified": the account isn't in *Test users*.
- Drive/Calendar show "not connected" but Gmail works: you unticked those scopes. Disconnect, sign in again and tick everything.

---

## Phase 4 — Slack

1. https://api.slack.com/apps → *Create New App* → *From scratch* → name `AutoFlow AI` → pick your workspace (create a free workspace for the project if needed).
2. *OAuth & Permissions → Bot Token Scopes*, add:
   `chat:write`, `chat:write.public`, `channels:read`, `groups:read`, `channels:history`, `groups:history`, `users:read`, `users:read.email`
3. *Install to Workspace* → copy the **Bot User OAuth Token** (`xoxb-…`).
4. In Slack, in each channel the bot should read: `/invite @AutoFlow AI` (posting to public channels works without an invite because of `chat:write.public`; reading history needs the invite).
5. Connect it: **Integrations → Slack → Connect** (paste the token and default channel), **or** put it in `.env` for everyone:
   ```env
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_DEFAULT_CHANNEL=#general
   ```

**Done when:** *Test* on the Slack card shows your workspace name, and asking the assistant "Summarize #general on Slack" returns real messages.

---

## Phase 5 — Jira Cloud

1. Create a free Jira Software site at https://www.atlassian.com/software/jira/free (e.g. `yourteam.atlassian.net`) and a **Scrum** project, e.g. key `AUTO`. Scrum gives you sprints, which the sprint analytics use.
2. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens → *Create API token*.
3. **Integrations → Jira → Connect**: site `yourteam.atlassian.net`, your Atlassian email, the token, default project `AUTO`.
   (Or use `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_DEFAULT_PROJECT` in `.env`.)

Notes: team-managed projects sometimes have no "Bug" type or priority field. The app automatically retries as a *Task* without priority. Assigning by name/email only works for users who are members of the site.

**Done when:** "Show pending Jira tasks" lists real issues, and approving a "Create Jira ticket" action creates a real `AUTO-n` issue.

---

## Phase 6 — GitHub

### 6.1 Token
1. GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
2. Repository access: select the repo(s) for the demo (create one, e.g. `autoflow-demo`).
3. Permissions: **Issues: Read and write**, **Pull requests: Read-only**, **Contents: Read-only**, **Metadata: Read-only**.
4. **Integrations → GitHub → Connect**: token plus default repo `yourname/autoflow-demo` (or `GITHUB_TOKEN` / `GITHUB_DEFAULT_REPO` in `.env`).

### 6.2 "PR merged → release notes" webhook (spec workflow 2)
The trigger needs GitHub to reach your backend, and `localhost` isn't reachable from the internet. For a local demo, use a tunnel:
1. Install ngrok (https://ngrok.com, free), then run `ngrok http 5000` and copy the `https://…ngrok-free.app` URL.
2. Generate a secret and put it in `.env` as `GITHUB_WEBHOOK_SECRET=...`, then restart the backend.
3. In the repo: *Settings → Webhooks → Add webhook*
   - Payload URL: `https://<your-ngrok>/api/webhooks/github`
   - Content type: `application/json`, Secret: the same value
   - Events: *Let me select* → **Pull requests**
4. In the app: Workflows → template **"GitHub PR Merged → Release Notes…"** → **Duplicate**. Templates never auto-run; only your copies do. Edit the copy and tick **Auto-approve external actions**, because webhook runs have nobody present to approve them.
5. Merge a PR. A new execution appears in *Execution Logs*.

Without ngrok you can still demo it: click **Run** on the template and enter trigger data `{"repo":"yourname/autoflow-demo","number":1}`.

**Done when:** "Show open pull requests" lists real PRs, and running the workflow creates release notes from a real PR.

---

## Phase 7 — Notion

1. Go to https://www.notion.so/profile/integrations → *New integration* → *Internal* → select your workspace → copy the **Internal Integration Secret**.
2. Create a page, e.g. "AutoFlow Reports". On that page click **⋯ → Connections → Connect to → AutoFlow AI**. The API can only see pages that are shared this way.
3. Copy the page ID: the 32-character code at the end of the page URL.
4. **Integrations → Notion → Connect**: secret plus parent page ID (or `NOTION_API_KEY` / `NOTION_PARENT_PAGE_ID` in `.env`).

**Done when:** processing meeting notes and syncing to Notion creates a child page under "AutoFlow Reports".

---

## Phase 8 — End-to-end test and viva demo script (about 12 minutes)

Rehearse this sequence at least twice. Reconnect Google the day before (see the 7-day note in Phase 3).

1. **Login & RBAC:** log in as admin. Show *Settings → Users* (roles) and the audit log.
2. **Integrations:** all 7 show CONNECTED. Mention that the tokens are AES-256-GCM encrypted and that one Google grant covers three services.
3. **Assistant:** "Summarize today's emails and create Jira tasks for bugs"
   - It fetches unread mail and shows the counts, then proposes Jira tickets as approval cards → *Approve* → open the issue in Jira.
4. **Assistant:** "Schedule tomorrow's sprint planning at 11 AM and notify everyone on Slack"
   - Two approval cards (Calendar + Slack) → *Approve all* → show the calendar event and the Slack message.
5. **Emails:** open the invoice email and show the AI **suggested workflow actions** (Save to Drive / Notify finance / Approval task). Run *Save to Drive*.
6. **Workflows:** run **Client Email → Jira → Slack → Meeting → Notion** → the approval dialog lists the external steps → *Approve & run* → walk through the step telemetry.
7. **Meetings:** create a meeting (AI agenda) → paste the sample notes → *Analyse notes* → *Approve & sync* to Notion, reminders and Jira.
8. **Smart Search:** "Project Alpha" across every source, then RAG: "What is the budget and timeline for Project Alpha?" (answer with [1] citations).
9. **Dashboard:** real metrics (runs per day, success rate, inbox by category, automated actions).
10. **Tests:** `npm test` → 40 passing (agent planner, workflow engine, safety guard, RBAC, crypto, RAG chunking).

---

## Running with Docker (optional)

```bash
cp .env.example .env    # fill in keys
docker compose up --build
```
Docker uses the bundled MongoDB container. To use Atlas instead, delete the `MONGODB_URI` line under `backend.environment` in `docker-compose.yml`. Open http://localhost:3000.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits with "No database available" | MongoDB isn't reachable. Check `MONGODB_URI`, the Atlas IP allow-list and the password (URL-encode special characters such as `@` → `%40`). |
| "Invalid or expired session" | The JWT expired (7 days) or `JWT_SECRET` changed. Log in again. |
| AI answers say "heuristic" | `GEMINI_API_KEY` is missing or invalid. *Settings* shows the last AI error. |
| Gmail "access expired or was revoked" | Testing-mode tokens last 7 days. Sign in with Google again. |
| Slack `not_in_channel` | Run `/invite @AutoFlow AI` in that channel. |
| Slack `missing_scope` | Add the scope named in the error, then **reinstall** the app and copy the new token. |
| Jira 401 | Wrong email/token pair, or the site URL includes `https://`. Enter just `yourteam.atlassian.net`. |
| Notion "No parent page" | Share a page with the integration (⋯ → Connections) and set the page ID. |
| Scheduled workflow never runs | Only your *copies* run automatically, they must be **Active**, and `SCHEDULER_ENABLED=true`. External steps also need *Auto-approve external actions*. |
| Frontend can't reach API | The backend must run on port 5000, or set `NEXT_PUBLIC_API_URL=http://<host>:5000` in `frontend/.env.local`. |

---

## Note for your project report and viva

Your specification document lists **Python/FastAPI, PostgreSQL, OpenAI, LangChain/LangGraph and Redis**. This implementation (like the code you already had) uses **Node.js/Express (TypeScript), MongoDB, Google Gemini and a hand-written agent loop**. Update the "Technology Stack" section of your report to match the code, or be ready to explain the choice. Defensible reasons:
- one language (TypeScript) across frontend and backend;
- the Gemini API has a free tier, while OpenAI's API is pay-as-you-go;
- MongoDB's flexible documents suit varied workflow configs and tool outputs;
- the agent loop (plan → act → observe) is the same pattern LangGraph implements, written out explicitly so you can explain every line.

Redis/BullMQ is listed under future enhancements. The built-in scheduler is in-process, which is fine for a single server.
