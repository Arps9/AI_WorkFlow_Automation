// In the browser we call the backend directly (NEXT_PUBLIC_API_URL) or through the Next.js /api rewrite.
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const TOKEN_KEY = 'autoflow_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) {
    super(message);
  }
}

async function request(url: string, options: RequestInit = {}) {
  const token = getToken();
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) {
    setToken(null);
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.href = '/login';
  }
  if (!res.ok) throw new ApiError(data?.error?.message || data?.error || data?.message || `Request failed (${res.status})`, res.status, data);
  return data;
}

const post = (url: string, body?: any) => request(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body || {}) });
const put = (url: string, body?: any) => request(url, { method: 'PUT', body: JSON.stringify(body || {}) });
const patch = (url: string, body?: any) => request(url, { method: 'PATCH', body: JSON.stringify(body || {}) });
const del = (url: string) => request(url, { method: 'DELETE' });

export const api = {
  getHealth: () => request('/api/health'),

  // auth
  login: (email: string, password: string) => post('/api/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => post('/api/auth/register', { name, email, password }),
  me: () => request('/api/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) => post('/api/auth/change-password', { currentPassword, newPassword }),
  getAuthStatus: () => request('/api/auth/status'),
  getGoogleAuthUrl: () => request('/api/auth/google/url'),
  disconnectGoogle: () => post('/api/auth/disconnect'),

  // integrations & tools
  getIntegrations: () => request('/api/integrations'),
  connectIntegration: (provider: string, credentials: Record<string, string>) => post(`/api/integrations/${provider}/connect`, { credentials }),
  testIntegration: (provider: string) => post(`/api/integrations/${provider}/test`),
  disconnectIntegration: (provider: string) => del(`/api/integrations/${provider}`),
  getTools: () => request('/api/tools'),
  executeTool: (name: string, parameters: any = {}, confirmed = false) => post(`/api/tools/${name}/execute`, { parameters, confirmed }),

  // gmail
  getEmails: (params: { q?: string; category?: string; maxResults?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.q) q.append('q', params.q);
    if (params.category && params.category !== 'All') q.append('category', params.category);
    if (params.maxResults) q.append('maxResults', String(params.maxResults));
    return request(`/api/gmail/messages?${q.toString()}`);
  },
  getEmailById: (id: string) => request(`/api/gmail/messages/${id}`),
  markEmailAsRead: (id: string) => post(`/api/gmail/messages/${id}/mark-read`),
  attachmentUrl: (id: string, attachmentId: string) => `${BASE_URL}/api/gmail/messages/${id}/attachments/${attachmentId}`,
  sendEmail: (data: { to: string; subject: string; body: string; threadId?: string; confirmed?: boolean }) => post('/api/gmail/send', data),

  // ai
  getAIStatus: () => request('/api/ai/status'),
  summarizeEmail: (data: { subject: string; body: string; sender?: string }) => post('/api/ai/summarize-email', data),
  generateReply: (data: { subject: string; body: string; sender?: string; userInstruction?: string }) => post('/api/ai/generate-reply', data),
  analyzeEmail: (messageId: string) => post('/api/ai/analyze-email', { messageId }),
  analyzeBatch: (limit = 10) => post('/api/ai/analyze-batch', { limit }),

  // assistant
  sendAssistantChat: (data: { message: string; sessionId: string }) => post('/api/assistant/chat', data),
  confirmAssistantAction: (data: { sessionId: string; toolCallId?: string; toolName?: string; parameters?: any }) => post('/api/assistant/confirm-action', data),
  rejectAssistantAction: (data: { sessionId: string; toolCallId: string }) => post('/api/assistant/reject-action', data),
  getAssistantSessions: () => request('/api/assistant/sessions'),
  getAssistantHistory: (sessionId: string) => request(`/api/assistant/history/${sessionId}`),
  deleteAssistantSession: (sessionId: string) => del(`/api/assistant/sessions/${sessionId}`),

  // workflows
  getWorkflows: () => request('/api/workflows'),
  getWorkflow: (id: string) => request(`/api/workflows/${id}`),
  createWorkflow: (data: any) => post('/api/workflows', data),
  updateWorkflow: (id: string, data: any) => put(`/api/workflows/${id}`, data),
  deleteWorkflow: (id: string) => del(`/api/workflows/${id}`),
  duplicateWorkflow: (id: string) => post(`/api/workflows/${id}/duplicate`),
  regenerateWebhook: (id: string) => post(`/api/workflows/${id}/webhook`),
  executeWorkflow: (id: string, opts: { triggerData?: any; confirmed?: boolean } = {}) => post(`/api/workflows/${id}/execute`, opts),
  getExecutions: (limit = 25) => request(`/api/executions?limit=${limit}`),
  getExecutionById: (id: string) => request(`/api/executions/${id}`),
  getExecutionLogs: (id: string) => request(`/api/executions/${id}/logs`),

  // search & knowledge
  search: (q: string, sources?: string[]) => request(`/api/search?q=${encodeURIComponent(q)}${sources?.length ? `&sources=${sources.join(',')}` : ''}`),
  getKnowledge: () => request('/api/knowledge'),
  uploadKnowledge: (file: File, title?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    return post('/api/knowledge/upload', fd);
  },
  addKnowledgeText: (title: string, text: string) => post('/api/knowledge/text', { title, text }),
  importDriveDoc: (fileId: string) => post('/api/knowledge/import/drive', { fileId }),
  importNotionPage: (pageId: string) => post('/api/knowledge/import/notion', { pageId }),
  deleteKnowledge: (id: string) => del(`/api/knowledge/${id}`),
  askKnowledge: (question: string) => post('/api/knowledge/ask', { question }),

  // meetings
  getMeetings: () => request('/api/meetings'),
  createMeeting: (data: any) => post('/api/meetings', data),
  regenerateAgenda: (id: string, context?: string) => post(`/api/meetings/${id}/agenda`, { context }),
  processMeetingNotes: (id: string, transcript: string) => post(`/api/meetings/${id}/notes`, { transcript }),
  syncMeeting: (id: string, opts: { notion?: boolean; reminders?: boolean; jira?: boolean; slack?: boolean; slackChannel?: string }) => post(`/api/meetings/${id}/sync`, opts),
  updateActionItem: (id: string, index: number, data: any) => patch(`/api/meetings/${id}/action-items/${index}`, data),
  deleteMeeting: (id: string) => del(`/api/meetings/${id}`),

  // analytics / admin
  getAnalytics: () => request('/api/analytics/overview'),
  getAuditLogs: (all = false) => request(`/api/audit-logs?limit=100${all ? '&all=true' : ''}`),
  getUsers: () => request('/api/admin/users'),
  updateUser: (id: string, data: { role?: string; isActive?: boolean }) => patch(`/api/admin/users/${id}`, data),
};
