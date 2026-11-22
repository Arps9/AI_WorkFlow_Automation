export type EmailCategoryName = 'Important' | 'Urgent' | 'Bug/Issue' | 'Client Request' | 'Meeting' | 'Normal' | 'Promotional';
export type PriorityName = 'High' | 'Medium' | 'Low';

export interface EmailSummaryResult {
  summary: string;
  keyPoints: string[];
  importantInformation?: string;
  isSimulated?: boolean;
}

export interface EmailClassificationResult {
  category: EmailCategoryName;
  priority: PriorityName;
  confidence: number;
  reasoning: string;
  isSimulated?: boolean;
}

export interface ActionExtractionResult {
  recommendedAction: string;
  actionType: 'create_task' | 'send_reply' | 'schedule_meeting' | 'investigate_incident' | 'archive' | 'none';
  priority: PriorityName;
  details?: Record<string, any>;
  isSimulated?: boolean;
}

export interface EmailReplyResult {
  subject: string;
  body: string;
  tone: string;
  isSimulated?: boolean;
}

export interface SuggestedAction {
  label: string;
  tool?: string;
  reason?: string;
}

/** Single-call combined analysis (keeps us inside free-tier rate limits). */
export interface FullEmailAnalysis {
  summary: string;
  keyPoints: string[];
  category: EmailCategoryName;
  priority: PriorityName;
  confidence: number;
  reasoning: string;
  recommendedAction: string;
  actionType: ActionExtractionResult['actionType'];
  suggestedReply: string;
  suggestedActions: SuggestedAction[];
  isSimulated?: boolean;
}

export interface BugDetails {
  title: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  component: string;
  stepsToReproduce: string[];
  expectedBehavior: string;
  actualBehavior: string;
  environment: string;
  isSimulated?: boolean;
}

export interface MeetingAnalysis {
  summary: string;
  decisions: string[];
  actionItems: Array<{ task: string; owner?: string; dueDate?: string }>;
  deadlines: string[];
  attendance: string[];
  isSimulated?: boolean;
}

export interface AgentToolCall {
  toolName: string;
  parameters: Record<string, any>;
  confirmationPrompt?: string;
}

export interface AgentStepResult {
  intent: string;
  replyMessage: string;
  toolCalls: AgentToolCall[];
  isSimulated?: boolean;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  parameters: any;
  requiresConfirmation?: boolean;
}

export interface AIProvider {
  name: string;
  isLive(): boolean;
  generateJSON<T>(prompt: string, validate: (raw: any) => T): Promise<T | null>;
  generateText(prompt: string): Promise<string | null>;
  embed(texts: string[]): Promise<number[][] | null>;
}
