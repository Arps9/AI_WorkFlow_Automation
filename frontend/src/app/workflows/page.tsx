'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Workflow as WorkflowIcon, Play, CheckCircle2, AlertCircle, ArrowRight, Zap, RotateCw, Plus, Copy, Trash2, Pencil, ArrowUp, ArrowDown, MinusCircle, ShieldAlert, Link2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { api } from '../../lib/api';
import { Workflow, WorkflowStep, ExecutionLog, ToolCatalogEntry } from '../../types';
import { formatDate } from '../../lib/utils';

const TRIGGERS = [
  { value: 'manual', label: 'Manual (Run button / assistant)' },
  { value: 'schedule', label: 'Schedule (every N minutes)' },
  { value: 'email_received', label: 'New Gmail email matching a query' },
  { value: 'github_pr_merged', label: 'GitHub pull request merged (webhook)' },
  { value: 'webhook', label: 'Generic webhook (POST)' },
];

const blankStep = (n: number): WorkflowStep => ({ id: `step-${n}`, name: `Step ${n}`, type: 'action', provider: '', tool: '', config: {}, order: n });

function StepEditor({ step, tools, onChange, onRemove, onMove, index, count }: { step: WorkflowStep; tools: ToolCatalogEntry[]; onChange: (s: WorkflowStep) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; index: number; count: number }) {
  const tool = tools.find((t) => t.name === step.tool);
  const [configText, setConfigText] = useState(JSON.stringify(step.config || {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const grouped = useMemo(() => tools.reduce<Record<string, ToolCatalogEntry[]>>((a, t) => ((a[t.provider] = [...(a[t.provider] || []), t]), a), {}), [tools]);
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500';

  return (
    <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-blue-400 w-12">STEP {index + 1}</span>
        <input className={input} value={step.name} onChange={(e) => onChange({ ...step, name: e.target.value })} placeholder="Step name" />
        <input className={`${input} w-28`} value={step.id} onChange={(e) => onChange({ ...step, id: e.target.value.replace(/\s+/g, '-') })} title="Step id (used in {{steps.<id>}})" />
        <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="p-1 text-slate-500 hover:text-white disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
        <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="p-1 text-slate-500 hover:text-white disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={onRemove} className="p-1 text-slate-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      <select
        className={input}
        value={step.tool}
        onChange={(e) => {
          const t = tools.find((x) => x.name === e.target.value);
          const cfg = Object.fromEntries(Object.entries(t?.parameters || {}).filter(([, p]) => p.required).map(([k]) => [k, '']));
          setConfigText(JSON.stringify(cfg, null, 2));
          onChange({ ...step, tool: e.target.value, provider: t?.provider || '', config: cfg, type: t?.provider === 'gemini' ? 'ai' : t?.requiresConfirmation ? 'action' : step.type });
        }}
      >
        <option value="">— choose a tool —</option>
        {Object.entries(grouped).map(([p, list]) => (
          <optgroup key={p} label={p.toUpperCase()}>
            {list.map((t) => (
              <option key={t.name} value={t.name}>{t.displayName}{t.requiresConfirmation ? ' ⚠' : ''}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {tool && (
        <p className="text-[10px] text-slate-500">
          {tool.description} · params: {Object.entries(tool.parameters).map(([k, p]) => `${k}${p.required ? '*' : ''}`).join(', ') || 'none'}
        </p>
      )}
      <textarea
        className={`${input} font-mono h-24`}
        value={configText}
        onChange={(e) => {
          setConfigText(e.target.value);
          try {
            onChange({ ...step, config: JSON.parse(e.target.value || '{}') });
            setJsonError(null);
          } catch {
            setJsonError('Invalid JSON');
          }
        }}
        placeholder='{"channel": "#general", "message": "{{steps.digest.headline}}"}'
      />
      {jsonError && <p className="text-[10px] text-rose-400">{jsonError}</p>}
      <div className="grid grid-cols-4 gap-2">
        <input className={input} placeholder="forEach (e.g. emails)" value={step.forEach || ''} onChange={(e) => onChange({ ...step, forEach: e.target.value || undefined })} />
        <input className={input} placeholder="if path (e.g. steps.x.count)" value={step.condition?.path || ''} onChange={(e) => onChange({ ...step, condition: e.target.value ? { operator: 'exists', ...step.condition, path: e.target.value } : undefined })} />
        <select className={input} value={step.condition?.operator || 'exists'} disabled={!step.condition} onChange={(e) => onChange({ ...step, condition: { ...step.condition!, operator: e.target.value } })}>
          {['exists', 'not_exists', 'gt', 'lt', 'eq', 'neq', 'contains'].map((o) => <option key={o}>{o}</option>)}
        </select>
        <input className={input} placeholder="value" disabled={!step.condition} value={step.condition?.value ?? ''} onChange={(e) => onChange({ ...step, condition: { ...step.condition!, value: e.target.value } })} />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-400">
        <input type="checkbox" checked={Boolean(step.continueOnError)} onChange={(e) => onChange({ ...step, continueOnError: e.target.checked })} /> Continue if this step fails
      </label>
    </div>
  );
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // run state
  const [confirmRun, setConfirmRun] = useState<Workflow | null>(null);
  const [triggerJson, setTriggerJson] = useState('');
  const [runOpen, setRunOpen] = useState(false);
  const [runTitle, setRunTitle] = useState('');
  const [runStatus, setRunStatus] = useState<'running' | 'completed' | 'failed'>('running');
  const [runLogs, setRunLogs] = useState<ExecutionLog[]>([]);
  const [runSummary, setRunSummary] = useState('');

  // builder state
  const [editing, setEditing] = useState<Partial<Workflow> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [w, t] = await Promise.all([api.getWorkflows(), api.getTools()]);
      setWorkflows(w.workflows || []);
      setTools(t.tools || []);
      setSelected((cur) => (cur ? w.workflows.find((x: Workflow) => x._id === cur._id) || w.workflows[0] : w.workflows[0]) || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startRun = (wf: Workflow) => {
    setTriggerJson('');
    setConfirmRun(wf);
  };

  const run = async (wf: Workflow, confirmed: boolean) => {
    let triggerData: any = {};
    if (triggerJson.trim()) {
      try {
        triggerData = JSON.parse(triggerJson);
      } catch {
        setError('Trigger data must be valid JSON');
        return;
      }
    }
    setConfirmRun(null);
    setRunTitle(wf.title);
    setRunOpen(true);
    setRunStatus('running');
    setRunLogs([]);
    setRunSummary('');
    try {
      const r = await api.executeWorkflow(wf._id, { triggerData, confirmed });
      setRunLogs(r.logs || []);
      setRunStatus(r.execution.status);
      setRunSummary(r.execution.summary || '');
      load();
    } catch (err: any) {
      setRunStatus('failed');
      setRunSummary(err.message);
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: editing.title,
        description: editing.description,
        category: editing.category || 'custom',
        trigger: editing.trigger,
        steps: (editing.steps || []).map((s, i) => ({ ...s, order: i + 1 })),
        isActive: editing.isActive ?? true,
        autoApproveExternalActions: Boolean(editing.autoApproveExternalActions),
      };
      if (editing._id) await api.updateWorkflow(editing._id, body);
      else await api.createWorkflow(body);
      setEditing(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const templates = workflows.filter((w) => w.isTemplate);
  const mine = workflows.filter((w) => !w.isTemplate);
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500';

  const WorkflowCard = ({ wf }: { wf: Workflow }) => (
    <Card onClick={() => setSelected(wf)} className={`flex flex-col justify-between ${selected?._id === wf._id ? 'border-blue-500 ring-1 ring-blue-500/30' : ''}`}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <WorkflowIcon className="w-4 h-4" />
          </div>
          <div className="flex gap-1">
            <Badge variant="secondary" className="text-[10px]">{wf.trigger.type.replace(/_/g, ' ')}</Badge>
            {!wf.isActive && <Badge className="text-[10px]">paused</Badge>}
          </div>
        </div>
        <h3 className="text-sm font-bold text-white mb-1">{wf.title}</h3>
        <p className="text-xs text-slate-400 line-clamp-3 mb-3">{wf.description}</p>
      </div>
      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{wf.steps.length} steps{wf.lastRunAt ? ` · ran ${formatDate(wf.lastRunAt)}` : ''}</span>
        <Button size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); startRun(wf); }}>
          <Play className="w-3 h-3 fill-current" /> Run
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflow Automation</h1>
          <p className="text-xs text-slate-400 mt-1">Multi-step pipelines across Gmail, Gemini, Slack, Jira, GitHub, Drive, Calendar and Notion — with approval for external actions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} isLoading={loading}><RotateCw className="w-3.5 h-3.5" /> Refresh</Button>
          <Button size="sm" onClick={() => setEditing({ title: '', description: '', category: 'custom', trigger: { type: 'manual', provider: 'system', config: {} }, steps: [blankStep(1)], isActive: true })}>
            <Plus className="w-3.5 h-3.5" /> New workflow
          </Button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-xs flex justify-between">{error}<button onClick={() => setError(null)}>×</button></div>}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Templates</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">{templates.map((wf) => <WorkflowCard key={wf._id} wf={wf} />)}</div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">My workflows</h2>
        {mine.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">{mine.map((wf) => <WorkflowCard key={wf._id} wf={wf} />)}</div>
        ) : (
          <p className="text-xs text-slate-500">Duplicate a template (to schedule it or connect a webhook) or build one from scratch.</p>
        )}
      </section>

      {selected && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-800 mb-5">
            <div>
              <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-1">Flow inspector</div>
              <h3 className="text-base font-bold text-white">{selected.title}</h3>
              <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">{selected.description}</p>
              {selected.webhookUrl && (
                <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" /> Webhook: <code className="text-slate-300 break-all">{selected.webhookUrl}</code>
                </div>
              )}
              {selected.trigger.type === 'github_pr_merged' && (
                <div className="mt-2 text-[11px] text-slate-500">GitHub webhook URL: <code>{'{BACKEND_URL}'}/api/webhooks/github</code> (event: Pull requests). Runs only for your copies of this workflow.</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => startRun(selected)}><Play className="w-3.5 h-3.5 fill-current" /> Run</Button>
              <Button size="sm" variant="secondary" onClick={async () => { await api.duplicateWorkflow(selected._id); load(); }}><Copy className="w-3.5 h-3.5" /> Duplicate</Button>
              {selected.isOwner && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(JSON.parse(JSON.stringify(selected)))}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Delete "${selected.title}"?`)) { await api.deleteWorkflow(selected._id); setSelected(null); load(); } }}><Trash2 className="w-3.5 h-3.5 text-rose-400" /></Button>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 overflow-x-auto pb-2">
            <div className="p-4 rounded-xl bg-slate-950 border border-emerald-900/60 shrink-0 w-full lg:w-48">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-400 mb-1"><Zap className="w-3.5 h-3.5" /> Trigger</div>
              <div className="text-xs font-bold text-white">{selected.trigger.type.replace(/_/g, ' ')}</div>
              <div className="text-[10px] text-slate-500 truncate">{selected.trigger.config?.intervalMinutes ? `every ${selected.trigger.config.intervalMinutes} min` : selected.trigger.config?.query || selected.trigger.provider}</div>
            </div>
            {[...selected.steps].sort((a, b) => a.order - b.order).map((s, i) => {
              const t = tools.find((x) => x.name === s.tool);
              return (
                <React.Fragment key={s.id}>
                  <ArrowRight className="hidden lg:block w-4 h-4 text-slate-600 shrink-0" />
                  <div className={`p-4 rounded-xl bg-slate-950 border shrink-0 w-full lg:w-56 ${t?.requiresConfirmation ? 'border-amber-900/70' : 'border-slate-800'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold uppercase text-blue-400">Step {i + 1}</span>
                      <span className="text-[9px] uppercase font-bold text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">{s.provider}</span>
                    </div>
                    <div className="text-xs font-bold text-slate-100">{s.name}</div>
                    <div className="text-[10px] font-mono text-slate-500 truncate">{s.tool}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {s.forEach && <Badge className="text-[9px]">for each {s.forEach}</Badge>}
                      {s.condition && <Badge className="text-[9px]">if {s.condition.path.split('.').pop()} {s.condition.operator} {s.condition.value ?? ''}</Badge>}
                      {t?.requiresConfirmation && <Badge variant="warning" className="text-[9px]">needs approval</Badge>}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </Card>
      )}

      {/* Approval before running */}
      <Modal isOpen={Boolean(confirmRun)} onClose={() => setConfirmRun(null)} title={`Run "${confirmRun?.title}"`} description="Review what this workflow will do" maxWidth="lg">
        {confirmRun && (
          <div className="space-y-4 text-xs">
            {confirmRun.externalActions?.length ? (
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/60">
                <div className="flex items-center gap-1.5 font-semibold text-amber-200 mb-2"><ShieldAlert className="w-4 h-4" /> {confirmRun.externalActions.length} step(s) change external systems</div>
                <ul className="space-y-1 text-amber-100/80">{confirmRun.externalActions.map((a) => <li key={a.stepId}>• {a.name} <span className="text-amber-300/60 font-mono">({a.tool})</span></li>)}</ul>
                <p className="mt-2 text-[11px] text-amber-200/70">Unconnected tools run in simulated demo mode. Connected tools perform real actions.</p>
              </div>
            ) : (
              <p className="text-slate-400">This workflow only reads data and runs AI analysis.</p>
            )}
            <div>
              <label className="text-[11px] font-semibold text-slate-400">Optional trigger data (JSON) — e.g. {'{"repo":"owner/repo","number":12}'} or {'{"channel":"#eng"}'}</label>
              <textarea className={`${input} font-mono text-xs h-20 mt-1`} value={triggerJson} onChange={(e) => setTriggerJson(e.target.value)} placeholder="{}" />
            </div>
            <div className="flex justify-end gap-2">
              {Boolean(confirmRun.externalActions?.length) && <Button variant="outline" size="sm" onClick={() => run(confirmRun, false)}>Run read-only steps</Button>}
              <Button size="sm" onClick={() => run(confirmRun, true)}><Play className="w-3.5 h-3.5 fill-current" /> {confirmRun.externalActions?.length ? 'Approve & run' : 'Run'}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Live run result */}
      <Modal isOpen={runOpen} onClose={() => setRunOpen(false)} title={runTitle} description="Step-by-step execution telemetry" maxWidth="2xl">
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
            {runStatus === 'running' && <RotateCw className="w-4 h-4 text-blue-400 animate-spin" />}
            {runStatus === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {runStatus === 'failed' && <AlertCircle className="w-4 h-4 text-rose-400" />}
            <span className="font-semibold uppercase tracking-wider text-[11px]">{runStatus}</span>
            <span className="text-slate-400 ml-2">{runSummary}</span>
          </div>
          <div className="space-y-2">
            {runLogs.map((l) => (
              <details key={l._id || l.stepIndex} className="rounded-lg bg-slate-950/80 border border-slate-800">
                <summary className="p-3 flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-2.5">
                    {l.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : l.status === 'skipped' ? <MinusCircle className="w-4 h-4 text-amber-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                    <span>
                      <span className="font-semibold text-slate-200 block">{l.stepName}</span>
                      <span className="text-[11px] text-slate-400">{l.message}</span>
                    </span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">{l.durationMs}ms</span>
                </summary>
                {l.outputPayload && <pre className="px-3 pb-3 text-[10px] text-slate-400 overflow-auto max-h-56">{JSON.stringify(l.outputPayload, null, 2)}</pre>}
              </details>
            ))}
            {runStatus === 'running' && <div className="py-6 text-center text-slate-400"><RotateCw className="w-5 h-5 text-blue-400 animate-spin mx-auto mb-2" />Executing…</div>}
          </div>
          <div className="flex justify-between items-center pt-3 border-t border-slate-800">
            <Link href="/executions" className="text-xs font-semibold text-blue-400 inline-flex items-center gap-1">Open audit logs <ArrowRight className="w-3 h-3" /></Link>
            <Button variant="secondary" size="sm" onClick={() => setRunOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>

      {/* Builder */}
      <Modal isOpen={Boolean(editing)} onClose={() => setEditing(null)} title={editing?._id ? 'Edit workflow' : 'New workflow'} description="Values in step config support {{trigger.x}}, {{steps.<id>.field}}, {{emails}}, {{item.x}} (inside forEach), {{user.email}}, {{today}} and {{a ?? fallback}}" maxWidth="2xl">
        {editing && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <input className={input} placeholder="Title" value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              <select className={input} value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {['custom', 'email_intelligence', 'customer_support', 'task_automation', 'meeting_assistant', 'devops'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <textarea className={`${input} h-16`} placeholder="Description" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <select className={input} value={editing.trigger?.type} onChange={(e) => setEditing({ ...editing, trigger: { type: e.target.value, provider: 'system', config: {} } })}>
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {editing.trigger?.type === 'schedule' && <input className={input} type="number" min={5} placeholder="Interval minutes (e.g. 1440 = daily)" value={editing.trigger.config?.intervalMinutes || ''} onChange={(e) => setEditing({ ...editing, trigger: { ...editing.trigger!, config: { ...editing.trigger!.config, intervalMinutes: Number(e.target.value) } } })} />}
              {editing.trigger?.type === 'email_received' && <input className={input} placeholder='Gmail query, e.g. from:client.com subject:bug' value={editing.trigger.config?.query || ''} onChange={(e) => setEditing({ ...editing, trigger: { ...editing.trigger!, config: { ...editing.trigger!.config, query: e.target.value } } })} />}
              {editing.trigger?.type === 'github_pr_merged' && <input className={input} placeholder="owner/repo (blank = any repo)" value={editing.trigger.config?.repo || ''} onChange={(e) => setEditing({ ...editing, trigger: { ...editing.trigger!, config: { ...editing.trigger!.config, repo: e.target.value } } })} />}
            </div>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={editing.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={Boolean(editing.autoApproveExternalActions)} onChange={(e) => setEditing({ ...editing, autoApproveExternalActions: e.target.checked })} /> Auto-approve external actions for scheduled / webhook runs</label>
            </div>
            <div className="space-y-2">
              {(editing.steps || []).map((s, i) => (
                <StepEditor
                  key={`${i}-${s.tool}`}
                  step={s}
                  index={i}
                  count={editing.steps!.length}
                  tools={tools}
                  onChange={(ns) => setEditing({ ...editing, steps: editing.steps!.map((x, j) => (j === i ? ns : x)) })}
                  onRemove={() => setEditing({ ...editing, steps: editing.steps!.filter((_, j) => j !== i) })}
                  onMove={(d) => {
                    const arr = [...editing.steps!];
                    [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
                    setEditing({ ...editing, steps: arr });
                  }}
                />
              ))}
              <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, steps: [...(editing.steps || []), blankStep((editing.steps?.length || 0) + 1)] })}>
                <Plus className="w-3.5 h-3.5" /> Add step
              </Button>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" onClick={save} isLoading={saving} disabled={!editing.title || !(editing.steps || []).every((s) => s.tool)}>Save workflow</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
