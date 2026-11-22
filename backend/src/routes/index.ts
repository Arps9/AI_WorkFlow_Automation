import { Router } from 'express';
import multer from 'multer';
import { asyncHandler as h } from '../utils/async-handler';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { authLimiter, aiLimiter } from '../middleware/rate-limit.middleware';
import { AuthController } from '../controllers/auth.controller';
import { GmailController } from '../controllers/gmail.controller';
import { AIController } from '../controllers/ai.controller';
import { AssistantController } from '../controllers/assistant.controller';
import { IntegrationsController, ToolsController } from '../controllers/integrations.controller';
import { WorkflowsController, WebhooksController } from '../controllers/workflows.controller';
import { KnowledgeController, SearchController } from '../controllers/knowledge.controller';
import { MeetingsController } from '../controllers/meetings.controller';
import { AnalyticsController, AdminController } from '../controllers/analytics.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------------------------------------------------------------- public routes
export const publicRouter = Router();
publicRouter.post('/auth/register', authLimiter, h(AuthController.register));
publicRouter.post('/auth/login', authLimiter, h(AuthController.login));
publicRouter.get('/auth/google/callback', h(AuthController.handleGoogleCallback));
publicRouter.post('/webhooks/github', h(WebhooksController.github));
publicRouter.post('/webhooks/workflows/:id/:token', h(WebhooksController.workflowWebhook));

// ---------------------------------------------------------------- authenticated routes
export const apiRouter = Router();
apiRouter.use(h(authenticate));

// auth & google oauth
apiRouter.get('/auth/me', h(AuthController.me));
apiRouter.post('/auth/change-password', h(AuthController.changePassword));
apiRouter.get('/auth/status', h(AuthController.getAuthStatus));
apiRouter.get('/auth/google/url', h(AuthController.getGoogleAuthUrl));
apiRouter.post('/auth/disconnect', h(AuthController.disconnectGoogle));

// gmail
apiRouter.get('/gmail/profile', h(GmailController.getProfile));
apiRouter.get('/gmail/messages', h(GmailController.getMessages));
apiRouter.get('/gmail/messages/:id', h(GmailController.getMessageById));
apiRouter.post('/gmail/messages/:id/mark-read', h(GmailController.markAsRead));
apiRouter.get('/gmail/messages/:id/attachments/:attachmentId', h(GmailController.downloadAttachment));
apiRouter.post('/gmail/send', h(GmailController.sendMessage));

// ai
apiRouter.get('/ai/status', h(AIController.status));
apiRouter.post('/ai/summarize-email', aiLimiter, h(AIController.summarizeEmail));
apiRouter.post('/ai/classify-email', aiLimiter, h(AIController.classifyEmail));
apiRouter.post('/ai/extract-actions', aiLimiter, h(AIController.extractActions));
apiRouter.post('/ai/extract-bug', aiLimiter, h(AIController.extractBug));
apiRouter.post('/ai/generate-reply', aiLimiter, h(AIController.generateReply));
apiRouter.post('/ai/analyze-email', aiLimiter, h(AIController.analyzeEmail));
apiRouter.post('/ai/analyze-batch', aiLimiter, h(AIController.analyzeBatch));
apiRouter.get('/ai/digest', aiLimiter, h(AIController.digest));

// assistant
apiRouter.post('/assistant/chat', aiLimiter, h(AssistantController.chat));
apiRouter.post('/assistant/confirm-action', h(AssistantController.confirmAction));
apiRouter.post('/assistant/reject-action', h(AssistantController.rejectAction));
apiRouter.get('/assistant/sessions', h(AssistantController.listSessions));
apiRouter.get('/assistant/history/:sessionId', h(AssistantController.getHistory));
apiRouter.delete('/assistant/sessions/:sessionId', h(AssistantController.deleteSession));

// integrations & tools
apiRouter.get('/integrations', h(IntegrationsController.getIntegrations));
apiRouter.post('/integrations/:provider/connect', h(IntegrationsController.connect));
apiRouter.post('/integrations/:provider/test', h(IntegrationsController.test));
apiRouter.delete('/integrations/:provider', h(IntegrationsController.disconnect));
apiRouter.get('/tools', h(ToolsController.catalog));
apiRouter.post('/tools/:name/execute', h(ToolsController.execute));

// workflows & executions
apiRouter.get('/workflows', h(WorkflowsController.listWorkflows));
apiRouter.post('/workflows', h(WorkflowsController.createWorkflow));
apiRouter.get('/workflows/:id', h(WorkflowsController.getWorkflow));
apiRouter.put('/workflows/:id', h(WorkflowsController.updateWorkflow));
apiRouter.delete('/workflows/:id', h(WorkflowsController.deleteWorkflow));
apiRouter.post('/workflows/:id/duplicate', h(WorkflowsController.duplicateWorkflow));
apiRouter.post('/workflows/:id/webhook', h(WorkflowsController.regenerateWebhook));
apiRouter.post('/workflows/:id/execute', h(WorkflowsController.executeWorkflow));
apiRouter.get('/executions', h(WorkflowsController.listExecutions));
apiRouter.get('/executions/:id', h(WorkflowsController.getExecutionById));
apiRouter.get('/executions/:id/logs', h(WorkflowsController.getExecutionLogs));

// smart search & knowledge base (RAG)
apiRouter.get('/search', h(SearchController.search));
apiRouter.get('/knowledge', h(KnowledgeController.list));
apiRouter.post('/knowledge/upload', upload.single('file'), h(KnowledgeController.upload));
apiRouter.post('/knowledge/text', h(KnowledgeController.addText));
apiRouter.post('/knowledge/import/drive', h(KnowledgeController.importDrive));
apiRouter.post('/knowledge/import/notion', h(KnowledgeController.importNotion));
apiRouter.post('/knowledge/ask', aiLimiter, h(KnowledgeController.ask));
apiRouter.delete('/knowledge/:id', h(KnowledgeController.remove));

// meeting assistant
apiRouter.get('/meetings', h(MeetingsController.list));
apiRouter.post('/meetings', h(MeetingsController.create));
apiRouter.get('/meetings/:id', h(MeetingsController.get));
apiRouter.post('/meetings/:id/agenda', h(MeetingsController.regenerateAgenda));
apiRouter.post('/meetings/:id/notes', h(MeetingsController.processNotes));
apiRouter.post('/meetings/:id/sync', h(MeetingsController.sync));
apiRouter.patch('/meetings/:id/action-items/:index', h(MeetingsController.updateActionItem));
apiRouter.delete('/meetings/:id', h(MeetingsController.remove));

// analytics, audit & admin (RBAC)
apiRouter.get('/analytics/overview', h(AnalyticsController.overview));
apiRouter.get('/audit-logs', h(AdminController.auditLogs));
apiRouter.get('/admin/users', requireRole('admin'), h(AdminController.listUsers));
apiRouter.patch('/admin/users/:id', requireRole('admin'), h(AdminController.updateUser));
