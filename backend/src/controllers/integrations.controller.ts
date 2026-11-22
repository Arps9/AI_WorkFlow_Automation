import { Request, Response } from 'express';
import { integrationsService } from '../services/integrations/integrations.service';
import { toolRegistry } from '../tools/tool-registry';
import { audit } from '../services/audit/audit.service';

export class IntegrationsController {
  static async getIntegrations(req: Request, res: Response) {
    const integrations = await integrationsService.getAllIntegrations(req.user!.id);
    res.json({ success: true, count: integrations.length, integrations });
  }

  static async connect(req: Request, res: Response) {
    const result = await integrationsService.connect(req.user!.id, req.params.provider, req.body.credentials || req.body);
    audit({ userId: req.user!.id, action: 'integration.connect', provider: req.params.provider, status: 'success', details: { accountName: result.accountName } });
    res.json({ success: true, ...result });
  }

  static async test(req: Request, res: Response) {
    res.json({ success: true, ...(await integrationsService.test(req.user!.id, req.params.provider)) });
  }

  static async disconnect(req: Request, res: Response) {
    const result = await integrationsService.disconnect(req.user!.id, req.params.provider);
    audit({ userId: req.user!.id, action: 'integration.disconnect', provider: req.params.provider, status: 'success' });
    res.json({ success: true, ...result });
  }
}

export class ToolsController {
  static async catalog(_req: Request, res: Response) {
    res.json({ success: true, tools: toolRegistry.getCatalog() });
  }

  /** Direct tool execution. Write tools require { confirmed: true } in the body. */
  static async execute(req: Request, res: Response) {
    const tool = toolRegistry.get(req.params.name);
    if (!tool) return res.status(404).json({ success: false, error: { message: `Tool ${req.params.name} not found`, statusCode: 404 } });
    const result = await toolRegistry.execute(tool.name, req.body.parameters || {}, { userId: req.user!.id, confirmed: req.body.confirmed === true, source: 'api' });
    res.json({ success: true, tool: tool.name, result });
  }
}
