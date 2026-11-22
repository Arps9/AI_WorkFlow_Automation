export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: any;
  enum?: string[];
}

export type ToolProvider = 'gmail' | 'gemini' | 'slack' | 'jira' | 'github' | 'notion' | 'drive' | 'calendar' | 'system';

export interface ToolContext {
  userId: string;
  confirmed?: boolean;
  /** Present when the tool runs inside a workflow: previous step outputs, trigger data, current forEach item */
  workflow?: Record<string, any>;
  source?: 'assistant' | 'workflow' | 'api';
}

export interface ToolDefinition {
  name: string;
  displayName: string;
  description: string;
  provider: ToolProvider;
  parameters: Record<string, ToolParameterSchema>;
  /** true = changes an external system; the registry blocks it unless context.confirmed */
  requiresConfirmation: boolean;
  actionType?: string;
  /** Hidden from the chat assistant (e.g. workflow-only helpers) */
  workflowOnly?: boolean;
  execute(params: any, context: ToolContext): Promise<any>;
}
