import { ToolDefinition, ToolContext } from './tool.interface';
import { gmailTools } from './gmail.tools';
import { collaborationTools } from './collaboration.tools';
import { googleTools } from './google.tools';
import { aiTools } from './ai.tools';
import { audit } from '../services/audit/audit.service';
import { logger } from '../utils/logger';
import { ToolManifestEntry } from '../services/ai/ai.provider';

export class ToolValidationError extends Error {
  statusCode = 400;
}

/**
 * Central registry + safety guard for every action the platform can take.
 * - Applies parameter defaults and validates required parameters
 * - Blocks tools that change external systems unless context.confirmed === true
 * - Writes an audit log entry for every execution
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools = new Map<string, ToolDefinition>();

  private constructor() {
    [...gmailTools, ...collaborationTools, ...googleTools, ...aiTools].forEach((t) => this.register(t));
    logger.info(`Registered ${this.tools.size} tools`);
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) ToolRegistry.instance = new ToolRegistry();
    return ToolRegistry.instance;
  }

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getForProvider(provider: string): ToolDefinition[] {
    return this.getAll().filter((t) => t.provider === provider);
  }

  /** Tool list shown to the LLM (workflow-only helpers and aliases are hidden). */
  public getAssistantToolManifest(): ToolManifestEntry[] {
    return this.getAll()
      .filter((t) => !t.workflowOnly)
      .map((t) => ({
        name: t.name,
        description: t.description,
        requiresConfirmation: t.requiresConfirmation,
        parameters: Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, `${v.type}${v.required ? ' (required)' : ''} — ${v.description}`])),
      }));
  }

  /** Public catalog for the workflow builder UI. */
  public getCatalog() {
    return this.getAll()
      .filter((t) => !/^gemini_/.test(t.name))
      .map((t) => ({ name: t.name, displayName: t.displayName, description: t.description, provider: t.provider, requiresConfirmation: t.requiresConfirmation, parameters: t.parameters }));
  }

  public prepareParams(tool: ToolDefinition, params: any): any {
    const out: any = { ...(params || {}) };
    for (const [key, schema] of Object.entries(tool.parameters)) {
      if ((out[key] === undefined || out[key] === '') && schema.default !== undefined) out[key] = schema.default;
      if (schema.type === 'number' && typeof out[key] === 'string' && out[key] !== '' && !Number.isNaN(Number(out[key]))) out[key] = Number(out[key]);
      if (schema.type === 'array' && typeof out[key] === 'string') out[key] = out[key].split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    return out;
  }

  public validate(tool: ToolDefinition, params: any) {
    const missing = Object.entries(tool.parameters)
      .filter(([k, s]) => s.required && (params[k] === undefined || params[k] === null || params[k] === ''))
      .map(([k]) => k);
    if (missing.length) throw new ToolValidationError(`Tool "${tool.name}" is missing required parameter(s): ${missing.join(', ')}`);
  }

  public async execute(name: string, params: any, context?: Partial<ToolContext>): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolValidationError(`Tool not found: ${name}`);
    const ctx: ToolContext = { userId: context?.userId || 'anonymous', confirmed: Boolean(context?.confirmed), workflow: context?.workflow, source: context?.source || 'api' };
    const prepared = this.prepareParams(tool, params);

    if (tool.requiresConfirmation && !ctx.confirmed) {
      return {
        status: 'pending_confirmation',
        actionType: tool.actionType || tool.name,
        toolName: tool.name,
        description: `${tool.displayName}: ${tool.description}`,
        targetResource: prepared.to || prepared.channel || prepared.projectKey || prepared.repo || prepared.summary || prepared.title || tool.provider,
        parameters: prepared,
      };
    }

    this.validate(tool, prepared);
    const started = Date.now();
    try {
      const result = await tool.execute(prepared, ctx);
      audit({
        userId: ctx.userId,
        action: tool.requiresConfirmation ? 'tool.write' : 'tool.read',
        resource: tool.name,
        provider: tool.provider,
        status: result?.simulated ? 'simulated' : 'success',
        details: { params: prepared, source: ctx.source, durationMs: Date.now() - started },
      });
      return result;
    } catch (err: any) {
      audit({ userId: ctx.userId, action: 'tool.error', resource: tool.name, provider: tool.provider, status: 'failure', details: { params: prepared, error: err.message, source: ctx.source } });
      throw err;
    }
  }
}

export const toolRegistry = ToolRegistry.getInstance();
