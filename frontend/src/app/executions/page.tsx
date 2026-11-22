'use client';

import React, { useState, useEffect } from 'react';
import {
  ScrollText,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Search,
  Code,
  Check,
  X,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { api } from '../../lib/api';
import { WorkflowExecution, ExecutionLog } from '../../types';
import { formatDate } from '../../lib/utils';

export default function ExecutionsPage() {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecution | null>(null);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [expandedPayloadIdx, setExpandedPayloadIdx] = useState<number | null>(null);

  const fetchExecutions = async () => {
    setIsLoading(true);
    try {
      const res = await api.getExecutions(25);
      setExecutions(res.executions || []);
      if (res.executions?.length > 0 && !selectedExecution) {
        handleSelectExecution(res.executions[0]);
      }
    } catch (err) {
      console.error('Failed to load executions', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExecutions();
  }, []);

  const handleSelectExecution = async (exec: WorkflowExecution) => {
    setSelectedExecution(exec);
    setIsLoadingLogs(true);
    setExpandedPayloadIdx(null);
    try {
      const res = await api.getExecutionLogs(exec._id);
      setExecutionLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to load execution logs', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Execution Audit Trail</h1>
            <Badge variant="secondary" className="text-[10px]">
              Audit Logs
            </Badge>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Complete telemetry, step progression timings, and immutable execution logs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchExecutions}
            className="text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Refresh Logs
          </Button>
        </div>
      </div>

      {/* Main Grid: Executions List on Left, Selected Execution Trace on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Executions Master Column (5 Cols) */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Workflow Run History ({executions.length})
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading audit history...</div>
          ) : executions.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl text-xs text-slate-400">
              No executions logged yet. Run a workflow to populate the audit trail.
            </div>
          ) : (
            executions.map((exec) => {
              const isSelected = selectedExecution?._id === exec._id;
              return (
                <div
                  key={exec._id}
                  onClick={() => handleSelectExecution(exec)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 border-blue-500 shadow-md ring-1 ring-blue-500/30'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-850/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-xs text-white truncate max-w-[220px]">
                      {exec.workflowTitle}
                    </span>
                    <Badge
                      variant={
                        exec.status === 'completed'
                          ? 'success'
                          : exec.status === 'failed'
                          ? 'urgent'
                          : 'warning'
                      }
                      className="text-[10px]"
                    >
                      {exec.status.toUpperCase()}
                    </Badge>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-3">
                    {exec.summary || 'Executing pipeline steps...'}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(exec.startTime)}
                    </span>
                    <span className="font-mono">
                      {exec.durationMs ? `${exec.durationMs}ms` : '—'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Execution Step Log Telemetry (7 Cols) */}
        <div className="lg:col-span-7 sticky top-24">
          {selectedExecution ? (
            <Card className="border-slate-800">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800 mb-4">
                <div>
                  <div className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1">
                    Execution Trace Details
                  </div>
                  <h2 className="text-base font-bold text-white leading-snug">
                    {selectedExecution.workflowTitle}
                  </h2>
                  <div className="text-[11px] text-slate-400 mt-1">
                    ID: <code className="text-slate-300 font-mono">{selectedExecution._id}</code>
                  </div>
                </div>

                <div className="text-right">
                  <Badge
                    variant={
                      selectedExecution.status === 'completed'
                        ? 'success'
                        : selectedExecution.status === 'failed'
                        ? 'urgent'
                        : 'warning'
                    }
                  >
                    {selectedExecution.status.toUpperCase()}
                  </Badge>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    Total: {selectedExecution.durationMs || 0}ms
                  </div>
                </div>
              </div>

              {/* Step Sequence Timeline */}
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Step Audit Trail ({executionLogs.length} steps)
                </div>

                {isLoadingLogs ? (
                  <div className="py-8 text-center text-xs text-slate-400">Loading step logs...</div>
                ) : executionLogs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">No logs for this execution.</div>
                ) : (
                  executionLogs.map((log, idx) => {
                    const isExpanded = expandedPayloadIdx === idx;
                    return (
                      <div
                        key={log._id || idx}
                        className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                                log.status === 'completed'
                                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                                  : log.status === 'skipped'
                                    ? 'bg-amber-950 border-amber-700 text-amber-400'
                                    : 'bg-rose-950 border-rose-700 text-rose-400'
                              }`}
                              title={log.status}
                            >
                              {log.status === 'completed' ? <Check className="w-3 h-3" /> : log.status === 'skipped' ? <span className="text-[10px] font-bold">–</span> : <span className="text-[10px] font-bold">!</span>}
                            </div>
                            <span className="font-semibold text-xs text-slate-200">
                              {log.stepName}
                            </span>
                            <span className="text-[9px] uppercase font-bold text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                              {log.provider}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-400">
                              {log.durationMs}ms
                            </span>
                            {log.outputPayload && (
                              <button
                                onClick={() =>
                                  setExpandedPayloadIdx(isExpanded ? null : idx)
                                }
                                className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 p-1 hover:bg-slate-900 rounded"
                              >
                                <Code className="w-3 h-3" />
                                {isExpanded ? 'Hide Payload' : 'Payload'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-400 pl-7">{log.message}</div>

                        {/* Collapsible JSON Output Payload Inspector */}
                        {isExpanded && log.outputPayload && (
                          <div className="mt-2 pl-7">
                            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 overflow-x-auto max-h-48 text-[10px] font-mono text-slate-300">
                              <pre>{JSON.stringify(log.outputPayload, null, 2)}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          ) : (
            <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl text-slate-400 text-xs">
              Select an execution run from the left to inspect its complete step telemetry and JSON payloads.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
