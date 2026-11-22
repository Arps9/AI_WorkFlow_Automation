export type EmailCategory =
  | 'Important'
  | 'Urgent'
  | 'Bug/Issue'
  | 'Client Request'
  | 'Meeting'
  | 'Normal'
  | 'Promotional';

export type EmailPriority = 'High' | 'Medium' | 'Low';

export interface EmailMessage {
  _id?: string;
  messageId: string;
  threadId?: string;
  sender: string;
  senderName?: string;
  recipient?: string;
  subject: string;
  receivedAt: string | Date;
  snippet?: string;
  bodyText?: string;
  summary?: string;
  category: EmailCategory;
  priority: EmailPriority;
  keyPoints?: string[];
  recommendedAction?: string;
  suggestedReply?: string;
  suggestedActions?: Array<{ label: string; tool?: string; reason?: string }>;
  attachments?: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>;
  analyzed?: boolean;
  isSimulatedAnalysis?: boolean;
  isRead: boolean;
  isStarred: boolean;
  labels?: string[];
  isDemoData?: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'action' | 'ai' | 'condition' | 'notification' | 'storage';
  provider: string;
  tool: string;
  config: Record<string, any>;
  forEach?: string;
  condition?: { path: string; operator: string; value?: any };
  continueOnError?: boolean;
  order: number;
}

export interface Workflow {
  _id: string;
  title: string;
  description: string;
  category: string;
  trigger: {
    type: string;
    provider: string;
    config: Record<string, any>;
  };
  steps: WorkflowStep[];
  isActive: boolean;
  isTemplate?: boolean;
  isOwner?: boolean;
  autoApproveExternalActions?: boolean;
  webhookUrl?: string;
  lastRunAt?: string;
  externalActions?: Array<{ stepId: string; name: string; tool: string; provider: string }>;
  createdAt: string;
}

export interface ExecutionLog {
  _id: string;
  executionId: string;
  stepIndex: number;
  stepId: string;
  stepName: string;
  provider: string;
  tool: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  inputPayload?: any;
  outputPayload?: any;
  durationMs: number;
  timestamp: string;
}

export interface WorkflowExecution {
  _id: string;
  workflowId: string;
  workflowTitle: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  triggerType: string;
  summary?: string;
  stats?: {
    itemsProcessed?: number;
    itemsSucceeded?: number;
    itemsFailed?: number;
  };
  startTime: string;
  endTime?: string;
  durationMs?: number;
  createdAt: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder: string;
  required: boolean;
  help?: string;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  status: 'connected' | 'available';
  connectionSource: 'user' | 'env' | 'demo' | 'none';
  accountEmail?: string;
  accountName?: string;
  capabilities: string[];
  tools: string[];
  authType: 'oauth2' | 'api_key';
  docsUrl?: string;
  credentialFields?: CredentialField[];
  oauthConfigured?: boolean;
  sharedGoogleGrant?: boolean;
  lastError?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string | Date;
  intent?: string;
  toolCalls?: Array<{
    id?: string;
    toolName: string;
    parameters: Record<string, any>;
    result?: any;
    status: 'executed' | 'pending_confirmation' | 'rejected' | 'failed';
    confirmationDetails?: {
      actionType: string;
      description: string;
      targetResource: string;
    };
  }>;
  emailReferences?: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'user';
  createdAt?: string;
  lastLoginAt?: string;
  isActive?: boolean;
}

export interface ToolCatalogEntry {
  name: string;
  displayName: string;
  description: string;
  provider: string;
  requiresConfirmation: boolean;
  parameters: Record<string, { type: string; description: string; required?: boolean; default?: any }>;
}

export interface Meeting {
  _id: string;
  title: string;
  scheduledAt?: string;
  durationMinutes: number;
  attendees: string[];
  agenda: string[];
  transcript?: string;
  summary?: string;
  decisions: string[];
  actionItems: Array<{ task: string; owner?: string; dueDate?: string; status: 'open' | 'done'; jiraKey?: string }>;
  deadlines: string[];
  attendance: string[];
  calendarLink?: string;
  notionPageUrl?: string;
  status: 'scheduled' | 'completed';
  isSimulated?: boolean;
  createdAt: string;
}

export interface KnowledgeDocument {
  _id: string;
  title: string;
  source: string;
  url?: string;
  chunkCount: number;
  charCount: number;
  embedded: boolean;
  createdAt: string;
}

export interface SearchResult {
  source: 'gmail' | 'drive' | 'jira' | 'github' | 'notion' | 'knowledge';
  title: string;
  snippet?: string;
  url?: string;
  id?: string;
  date?: string;
  simulated?: boolean;
}
