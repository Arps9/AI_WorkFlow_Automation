import { workflowEngine } from '../src/services/workflows/workflow.engine';
import { WorkflowModel } from '../src/models/workflow.model';
import { WorkflowExecutionModel } from '../src/models/workflow-execution.model';
import { ExecutionLogModel } from '../src/models/execution-log.model';
import { WORKFLOW_TEMPLATES } from '../src/utils/workflow-templates';
import { resolveTemplates, evaluateCondition } from '../src/services/workflows/template';

describe('Workflow templates', () => {
  const ctx = { trigger: { repo: 'a/b', channel: '' }, steps: { jira: { first: { key: 'AUTO-1' } }, list: { issues: [1, 2, 3] } }, item: { title: 'Bug' }, user: { email: 'me@x.com' } };

  it('resolves placeholders, raw values and fallbacks', () => {
    expect(resolveTemplates('Ticket {{steps.jira.first.key}} for {{item.title}}', ctx)).toBe('Ticket AUTO-1 for Bug');
    expect(resolveTemplates('{{steps.list.issues}}', ctx)).toEqual([1, 2, 3]);
    expect(resolveTemplates('{{steps.list.issues.length}} open', ctx)).toBe('3 open');
    expect(resolveTemplates('{{trigger.stakeholders ?? user.email}}', ctx)).toBe('me@x.com');
    expect(resolveTemplates('{{trigger.time ?? tomorrow at 11am}}', ctx)).toBe('tomorrow at 11am');
  });

  it('evaluates step conditions', () => {
    expect(evaluateCondition({ path: 'steps.list.issues', operator: 'gt', value: 2 }, ctx)).toBe(true);
    expect(evaluateCondition({ path: 'trigger.channel', operator: 'exists' }, ctx)).toBe(false);
  });
});

describe('Workflow engine', () => {
  beforeEach(() => {
    jest.spyOn(WorkflowExecutionModel.prototype, 'save').mockImplementation(function (this: any) {
      return Promise.resolve(this);
    });
    jest.spyOn(ExecutionLogModel.prototype, 'save').mockImplementation(function (this: any) {
      return Promise.resolve(this);
    });
    jest.spyOn(WorkflowModel, 'updateOne').mockResolvedValue({} as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const asWorkflow = (t: any) => ({ ...t, _id: 'wf-test', autoApproveExternalActions: false } as any);

  it('runs read/AI steps and skips unapproved external actions', async () => {
    const { execution, logs } = await workflowEngine.executeWorkflow(asWorkflow(WORKFLOW_TEMPLATES[0]), {}, { userId: 'u1' });
    expect(execution.status).toBe('completed');
    expect(logs).toHaveLength(WORKFLOW_TEMPLATES[0].steps!.length);
    expect(logs.find((l) => l.stepId === 'alert')?.status).toBe('skipped');
    expect(logs.find((l) => l.stepId === 'digest')?.status).toBe('completed');
  });

  it('executes the full client-email → Jira → Slack → Calendar → Notion pipeline when approved', async () => {
    const { execution, logs } = await workflowEngine.executeWorkflow(asWorkflow(WORKFLOW_TEMPLATES[1]), {}, { userId: 'u1', confirmed: true });
    expect(execution.status).toBe('completed');
    expect(logs.every((l) => l.status === 'completed')).toBe(true);
    const jira = logs.find((l) => l.stepId === 'jira');
    expect(jira.outputPayload.count).toBeGreaterThan(0);
  });

  it('runs the meeting workflow from sample data', async () => {
    const { execution, logs } = await workflowEngine.executeWorkflow(asWorkflow(WORKFLOW_TEMPLATES[3]), {}, { userId: 'u1', confirmed: true });
    expect(execution.status).toBe('completed');
    expect(logs.find((l) => l.stepId === 'jira')?.outputPayload.count).toBeGreaterThan(0);
  });

  it('lists external actions for the approval prompt', () => {
    const ext = workflowEngine.externalActions(WORKFLOW_TEMPLATES[2] as any);
    expect(ext.map((e) => e.tool)).toEqual(['notion_create_page', 'slack_send_message', 'gmail_send_message']);
  });
});
