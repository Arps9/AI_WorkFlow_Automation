'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Mail,
  Search,
  RefreshCw,
  Sparkles,
  Bot,
  CheckCircle2,
  AlertCircle,
  Clock,
  Star,
  Send,
  Check,
  X,
  FileText,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { api } from '../../lib/api';
import { EmailMessage, EmailCategory } from '../../types';
import { formatDate } from '../../lib/utils';
import { getToken } from '../../lib/api';
import { Paperclip, Zap } from 'lucide-react';

export default function EmailsPage() {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Reply Modal state
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState({ subject: '', body: '' });
  const [isDraftingReply, setIsDraftingReply] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [replyStatusMessage, setReplyStatusMessage] = useState<string | null>(null);

  // Action modal state (Jira / Slack / Drive / Calendar / Notion / GitHub)
  const [action, setAction] = useState<{ tool: string; label: string; params: any } | null>(null);
  const [actionParams, setActionParams] = useState('');
  const [actionResult, setActionResult] = useState<any>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [unanalyzed, setUnanalyzed] = useState(0);
  const [batchBusy, setBatchBusy] = useState(false);
  const [source, setSource] = useState<string>('');

  const paramsFor = (tool: string, e: EmailMessage): any => {
    const body = `${e.summary || e.snippet || ''}\n\nFrom: ${e.senderName || e.sender} <${e.sender}>`;
    switch (tool) {
      case 'jira_create_issue':
        return { summary: e.subject, description: body, issueType: e.category === 'Bug/Issue' || e.category === 'Urgent' ? 'Bug' : 'Task', priority: 'auto' };
      case 'github_create_issue':
        return { title: e.subject, body };
      case 'slack_send_message':
        return { channel: '', message: `:envelope_with_arrow: *${e.subject}* — ${e.senderName || e.sender}\n${e.summary || e.snippet || ''}` };
      case 'calendar_create_event':
        return { summary: e.subject.replace(/^(re:|fwd?:)\s*/i, ''), start: 'tomorrow at 11am', durationMinutes: 30, attendees: [e.sender], description: e.summary || '' };
      case 'drive_save_attachment':
        return { messageId: e.messageId, folderName: /invoice/i.test(e.subject) ? 'Invoices' : 'AutoFlow Attachments' };
      case 'notion_create_page':
        return { title: e.subject, content: `## Summary\n${e.summary || ''}\n\n## Key points\n${(e.keyPoints || []).map((k) => `- ${k}`).join('\n')}` };
      default:
        return {};
    }
  };

  const openAction = (tool: string, label: string, e: EmailMessage) => {
    if (tool === 'gmail_send_message') return handleGenerateReply(e);
    const params = paramsFor(tool, e);
    setAction({ tool, label, params });
    setActionParams(JSON.stringify(params, null, 2));
    setActionResult(null);
  };

  const runAction = async () => {
    if (!action) return;
    setActionBusy(true);
    try {
      const r = await api.executeTool(action.tool, JSON.parse(actionParams || '{}'), true);
      setActionResult(r.result);
    } catch (err: any) {
      setActionResult({ error: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const downloadAttachment = async (e: EmailMessage, a: { attachmentId: string; filename: string }) => {
    const res = await fetch(api.attachmentUrl(e.messageId, a.attachmentId), { headers: { Authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const analyzeInbox = async () => {
    setBatchBusy(true);
    try {
      await api.analyzeBatch(10);
      await fetchEmails();
    } finally {
      setBatchBusy(false);
    }
  };

  const categories = [
    'All',
    'Urgent',
    'Bug/Issue',
    'Client Request',
    'Meeting',
    'Important',
    'Normal',
    'Promotional',
  ];

  const fetchEmails = async () => {
    setIsLoading(true);
    try {
      const res = await api.getEmails({
        category: activeCategory !== 'All' ? activeCategory : undefined,
        q: searchQuery || undefined,
      });
      setEmails(res.messages || []);
      setUnanalyzed(res.unanalyzed || 0);
      setSource(res.source || '');
      if (res.messages?.length > 0 && !selectedEmail) {
        setSelectedEmail(res.messages[0]);
      }
    } catch (err) {
      console.error('Failed to fetch emails', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, [activeCategory]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEmails();
  };

  const handleSelectEmail = (email: EmailMessage) => {
    setSelectedEmail(email);
  };

  const handleMarkAsRead = async (email: EmailMessage) => {
    try {
      await api.markEmailAsRead(email.messageId);
      setEmails((prev) =>
        prev.map((e) => (e.messageId === email.messageId ? { ...e, isRead: true } : e))
      );
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail({ ...selectedEmail, isRead: true });
      }
    } catch (err) {
      console.error('Failed to mark read', err);
    }
  };

  const handleGenerateReply = async (email: EmailMessage) => {
    setIsDraftingReply(true);
    setReplyModalOpen(true);
    setReplyStatusMessage(null);
    try {
      const res = await api.generateReply({
        subject: email.subject,
        body: email.bodyText || email.snippet || '',
        sender: email.sender,
      });
      setReplyDraft({
        subject: res.result.subject,
        body: res.result.body,
      });
    } catch (err) {
      console.error('Failed to generate reply draft', err);
      setReplyDraft({
        subject: `Re: ${email.subject}`,
        body: `Hi,\n\nThank you for reaching out. We have received your message regarding "${email.subject}" and will follow up with details shortly.\n\nBest regards,\nEnterprise Team`,
      });
    } finally {
      setIsDraftingReply(false);
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmail) return;
    setIsSendingReply(true);
    try {
      await api.sendEmail({
        to: selectedEmail.sender,
        subject: replyDraft.subject,
        body: replyDraft.body,
        threadId: selectedEmail.threadId,
        confirmed: true,
      });
      setReplyStatusMessage(source === 'demo' ? 'Simulated send (demo inbox) — connect Google to send for real.' : 'Reply sent via Gmail API!');
      setTimeout(() => {
        setReplyModalOpen(false);
        setReplyStatusMessage(null);
      }, 2000);
    } catch (err: any) {
      setReplyStatusMessage(`Failed to send: ${err.message}`);
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleAnalyzeEmail = async (email: EmailMessage) => {
    setIsAnalyzing(true);
    try {
      const res = await api.analyzeEmail(email.messageId);
      if (res.success && res.analysis) {
        const merged = { ...email, ...res.analysis, isRead: email.isRead, analyzed: true };
        setSelectedEmail(merged);
        setEmails((prev) => prev.map((e) => (e.messageId === email.messageId ? merged : e)));
        setUnanalyzed((n) => Math.max(0, n - (email.analyzed ? 0 : 1)));
      }
    } catch (err) {
      console.error('Failed to analyze email', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Email Intelligence Hub</h1>
            <Badge variant="secondary" className="text-[10px]">
              Gmail API
            </Badge>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Enterprise Gmail sync with real-time Gemini summarization, priority tagging, and action staging.
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subject, bug, client..."
              className="bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-blue-500 w-64"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" className="text-xs">
            Filter
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchEmails}
            className="text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {unanalyzed > 0 && (
            <Button type="button" size="sm" className="text-xs" onClick={analyzeInbox} isLoading={batchBusy}>
              <Sparkles className="w-3.5 h-3.5" /> Analyse inbox ({unanalyzed})
            </Button>
          )}
          {source === 'demo' && <Badge variant="warning" className="text-[10px]">Demo inbox</Badge>}
        </form>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {categories.map((cat) => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                isActive
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800/80'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Master-Detail Email Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Email List Column (5 Cols) */}
        <div className="lg:col-span-5 space-y-2.5">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading inbox messages...</div>
          ) : emails.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl text-xs text-slate-400">
              No emails matching your filter.
            </div>
          ) : (
            emails.map((email) => {
              const isSelected = selectedEmail?.messageId === email.messageId;
              return (
                <div
                  key={email.messageId}
                  onClick={() => handleSelectEmail(email)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 border-blue-500/60 shadow-md ring-1 ring-blue-500/30'
                      : 'bg-slate-900/60 border-slate-800/70 hover:border-slate-700 hover:bg-slate-850/60'
                  } ${!email.isRead ? 'border-l-4 border-l-blue-500' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs truncate max-w-[200px] ${
                        !email.isRead ? 'font-bold text-white' : 'font-medium text-slate-300'
                      }`}
                    >
                      {email.senderName || email.sender}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatDate(email.receivedAt)}
                    </span>
                  </div>

                  <h4
                    className={`text-xs mb-1.5 truncate ${
                      !email.isRead ? 'font-semibold text-slate-100' : 'text-slate-300'
                    }`}
                  >
                    {email.subject}
                  </h4>

                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-3">
                    {email.summary || email.snippet}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/50">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={
                          email.category === 'Bug/Issue'
                            ? 'bug'
                            : email.category === 'Urgent'
                            ? 'urgent'
                            : email.category === 'Client Request'
                            ? 'client'
                            : email.category === 'Meeting'
                            ? 'meeting'
                            : 'default'
                        }
                        className="text-[10px]"
                      >
                        {email.category}
                      </Badge>
                      <Badge
                        variant={email.priority === 'High' ? 'urgent' : 'default'}
                        className="text-[10px]"
                      >
                        {email.priority}
                      </Badge>
                    </div>

                    {email.isDemoData && (
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
                        Demo
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Email Detail + AI Analysis (7 Cols) */}
        <div className="lg:col-span-7 sticky top-24">
          {selectedEmail ? (
            <div className="space-y-4">
              {/* Email Content Header */}
              <Card>
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-white leading-snug">
                      {selectedEmail.subject}
                    </h2>
                    <div className="text-xs text-slate-300">
                      From:{' '}
                      <span className="font-semibold text-slate-100">
                        {selectedEmail.senderName || selectedEmail.sender}
                      </span>{' '}
                      <span className="text-slate-400">({selectedEmail.sender})</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Received: {new Date(selectedEmail.receivedAt).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!selectedEmail.isRead && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleMarkAsRead(selectedEmail)}
                        className="text-xs"
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Mark Read
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleGenerateReply(selectedEmail)}
                      className="text-xs"
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      Generate Reply
                    </Button>
                  </div>
                </div>

                {/* Email Body */}
                <div className="py-4 text-xs text-slate-300 leading-relaxed whitespace-pre-line max-h-56 overflow-y-auto font-sans bg-slate-950/40 p-3 rounded-lg border border-slate-800/60 mt-3">
                  {selectedEmail.bodyText || selectedEmail.snippet}
                </div>
              </Card>

              {/* AI Analysis Panel */}
              <Card className="border-blue-900/40 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/20">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-sm font-semibold text-white tracking-tight">
                      Gemini AI Analysis
                    </h3>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAnalyzeEmail(selectedEmail)}
                    isLoading={isAnalyzing}
                    className="text-[11px] py-1 px-2 h-7"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Re-Analyze
                  </Button>
                </div>

                <div className="space-y-4 text-xs">
                  {/* Executive Summary */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Executive Summary
                    </div>
                    <p className="text-slate-200 leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      {selectedEmail.summary || 'Summary not yet generated.'}
                    </p>
                  </div>

                  {/* Metadata Row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Category
                      </div>
                      <Badge
                        variant={
                          selectedEmail.category === 'Bug/Issue'
                            ? 'bug'
                            : selectedEmail.category === 'Urgent'
                            ? 'urgent'
                            : selectedEmail.category === 'Client Request'
                            ? 'client'
                            : selectedEmail.category === 'Meeting'
                            ? 'meeting'
                            : 'default'
                        }
                      >
                        {selectedEmail.category}
                      </Badge>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Priority Level
                      </div>
                      <Badge
                        variant={selectedEmail.priority === 'High' ? 'urgent' : 'default'}
                      >
                        {selectedEmail.priority} Priority
                      </Badge>
                    </div>
                  </div>

                  {/* Key Points */}
                  {selectedEmail.keyPoints && selectedEmail.keyPoints.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Key Points
                      </div>
                      <ul className="space-y-1.5 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                        {selectedEmail.keyPoints.map((point, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-slate-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 mt-1.5"></span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommended Action */}
                  <div className="p-3 rounded-lg bg-blue-950/30 border border-blue-800/50">
                    <div className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1">
                      Recommended Action
                    </div>
                    <p className="text-slate-200 font-medium">
                      {selectedEmail.analyzed === false ? 'Not analysed yet — click Analyse.' : selectedEmail.recommendedAction || 'Review incoming email details'}
                    </p>
                    {selectedEmail.isSimulatedAnalysis && selectedEmail.analyzed !== false && (
                      <p className="text-[10px] text-amber-400/80 mt-1">Heuristic analysis{selectedEmail.isDemoData ? ' (curated demo email)' : ' — set GEMINI_API_KEY for AI'}</p>
                    )}
                  </div>

                  {/* AI workflow suggestions */}
                  {(selectedEmail.suggestedActions || []).length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" /> Suggested workflow actions
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedEmail.suggestedActions!.filter((a) => a.tool).map((a, i) => (
                          <button key={i} title={a.reason} onClick={() => openAction(a.tool!, a.label, selectedEmail)} className="text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-amber-100 hover:bg-amber-900/40">
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Attachments */}
                  {(selectedEmail.attachments || []).length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Attachments</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedEmail.attachments!.map((a) => (
                          <button key={a.attachmentId} onClick={() => downloadAttachment(selectedEmail, a)} className="text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:border-slate-600 inline-flex items-center gap-1.5">
                            <Paperclip className="w-3 h-3" /> {a.filename} <span className="text-slate-500">{Math.round(a.size / 1024)} KB</span>
                          </button>
                        ))}
                        <button onClick={() => openAction('drive_save_attachment', 'Save attachments to Drive', selectedEmail)} className="text-[11px] px-2.5 py-1.5 rounded-lg bg-blue-950/40 border border-blue-800/60 text-blue-200">Save to Drive</button>
                      </div>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="primary" onClick={() => handleGenerateReply(selectedEmail)} className="text-xs">
                      <Send className="w-3.5 h-3.5 mr-1" />
                      Generate Reply
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAction('jira_create_issue', 'Create Jira ticket', selectedEmail)} className="text-xs">
                      <FileText className="w-3.5 h-3.5 mr-1" />
                      Jira Ticket
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAction('github_create_issue', 'Create GitHub issue', selectedEmail)} className="text-xs">GitHub Issue</Button>
                    <Button size="sm" variant="outline" onClick={() => openAction('slack_send_message', 'Notify Slack', selectedEmail)} className="text-xs">Notify Slack</Button>
                    <Button size="sm" variant="outline" onClick={() => openAction('calendar_create_event', 'Schedule meeting', selectedEmail)} className="text-xs">
                      <Calendar className="w-3.5 h-3.5 mr-1" />
                      Meeting
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAction('notion_create_page', 'Save to Notion', selectedEmail)} className="text-xs">Notion</Button>
                    <Link href="/workflows">
                      <Button size="sm" variant="outline" className="text-xs">
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        Trigger in Workflow
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          ) : (
            <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl text-slate-400 text-xs">
              Select an email from the left to inspect its Gemini AI summary and analysis.
            </div>
          )}
        </div>
      </div>

      {/* Reply Generation Modal */}
      <Modal
        isOpen={replyModalOpen}
        onClose={() => setReplyModalOpen(false)}
        title="AI-Generated Reply Draft"
        description="Review and edit the Gemini drafted response. The email will only be dispatched upon your explicit confirmation."
        maxWidth="lg"
      >
        <div className="space-y-4 text-xs">
          {isDraftingReply ? (
            <div className="py-8 text-center text-slate-400">
              <Bot className="w-6 h-6 text-blue-400 animate-bounce mx-auto mb-2" />
              Generating executive reply with Gemini AI...
            </div>
          ) : (
            <>
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Recipient</label>
                <input
                  type="text"
                  value={selectedEmail?.sender || ''}
                  disabled
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Subject</label>
                <input
                  type="text"
                  value={replyDraft.subject}
                  onChange={(e) => setReplyDraft({ ...replyDraft, subject: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Message Body</label>
                <textarea
                  rows={8}
                  value={replyDraft.body}
                  onChange={(e) => setReplyDraft({ ...replyDraft, body: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-blue-500 leading-relaxed font-sans"
                />
              </div>

              {replyStatusMessage && (
                <div className="p-3 rounded-lg bg-blue-950/60 border border-blue-800 text-blue-300 text-xs">
                  {replyStatusMessage}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReplyModalOpen(false)}
                  disabled={isSendingReply}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSendReply}
                  isLoading={isSendingReply}
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  Confirm & Send Email
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Action modal */}
      <Modal isOpen={Boolean(action)} onClose={() => setAction(null)} title={action?.label || 'Run action'} description="Review the parameters — this changes an external system (simulated if the tool isn't connected)." maxWidth="lg">
        <div className="space-y-3 text-xs">
          <div className="text-[11px] text-slate-400">Tool: <code className="text-slate-200">{action?.tool}</code></div>
          <textarea className="w-full h-48 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-blue-500" value={actionParams} onChange={(e) => setActionParams(e.target.value)} />
          {actionResult && (
            <div className={`p-3 rounded-lg border text-[11px] ${actionResult.error ? 'bg-rose-950/40 border-rose-900 text-rose-200' : 'bg-emerald-950/40 border-emerald-900 text-emerald-200'}`}>
              {actionResult.error || actionResult.message || 'Done'}
              {actionResult.simulated && <span className="block text-amber-300 mt-1">Simulated — connect this integration for a real action.</span>}
              {actionResult.url && actionResult.url !== '#' && <a href={actionResult.url} target="_blank" rel="noreferrer" className="block underline mt-1">{actionResult.url}</a>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAction(null)}>Close</Button>
            {!actionResult?.status && <Button size="sm" onClick={runAction} isLoading={actionBusy}>Approve & run</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
