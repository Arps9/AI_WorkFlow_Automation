'use client';

import React, { useEffect, useState } from 'react';
import { Search, Mail, HardDrive, CheckSquare, GitBranch, FileText, BookOpen, Upload, Trash2, Sparkles, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { api } from '../../lib/api';
import { KnowledgeDocument, SearchResult } from '../../types';
import { formatDate } from '../../lib/utils';

const SOURCES = [
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'drive', label: 'Drive', icon: HardDrive },
  { id: 'jira', label: 'Jira', icon: CheckSquare },
  { id: 'github', label: 'GitHub', icon: GitBranch },
  { id: 'notion', label: 'Notion', icon: FileText },
  { id: 'knowledge', label: 'Knowledge base', icon: BookOpen },
];

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string[]>(SOURCES.map((s) => s.id));
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ summary?: string; results: SearchResult[]; counts: Record<string, number>; errors: Record<string, string> } | null>(null);

  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importKind, setImportKind] = useState<'text' | 'drive' | 'notion'>('text');
  const [importTitle, setImportTitle] = useState('');
  const [importValue, setImportValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadDocs = () => api.getKnowledge().then((r) => setDocs(r.documents || [])).catch(() => null);
  useEffect(() => {
    loadDocs();
  }, []);

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResult(await api.search(q, active));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    try {
      setAnswer(await api.askKnowledge(question));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAsking(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadKnowledge(file);
      loadDocs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const importDoc = async () => {
    setUploading(true);
    setError(null);
    try {
      if (importKind === 'text') await api.addKnowledgeText(importTitle, importValue);
      if (importKind === 'drive') await api.importDriveDoc(importValue.trim());
      if (importKind === 'notion') await api.importNotionPage(importValue.trim().split('-').pop() || importValue.trim());
      setAddOpen(false);
      setImportTitle('');
      setImportValue('');
      loadDocs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const iconFor = (src: string) => SOURCES.find((s) => s.id === src)?.icon || Search;
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Smart Search & Knowledge Base</h1>
        <p className="text-xs text-slate-400 mt-1">One natural-language query across every connected tool, plus Retrieval-Augmented Generation over your documents.</p>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-xs flex justify-between">{error}<button onClick={() => setError(null)}>×</button></div>}

      <Card>
        <form onSubmit={runSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input className={`${input} pl-9 py-2.5`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Find documents related to Project Alpha" />
          </div>
          <Button type="submit" isLoading={searching}>Search</Button>
        </form>
        <div className="flex flex-wrap gap-2 mt-3">
          {SOURCES.map((s) => {
            const on = active.includes(s.id);
            return (
              <button key={s.id} type="button" onClick={() => setActive(on ? active.filter((x) => x !== s.id) : [...active, s.id])} className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${on ? 'bg-blue-600/20 border-blue-500/50 text-blue-200' : 'border-slate-800 text-slate-500'}`}>
                <s.icon className="w-3 h-3" /> {s.label}
                {result?.counts?.[s.id] !== undefined && <span className="text-[10px] text-slate-400">{result.counts[s.id]}</span>}
              </button>
            );
          })}
        </div>

        {result && (
          <div className="mt-5 space-y-3">
            {result.summary && (
              <div className="p-3 rounded-lg bg-blue-950/30 border border-blue-900/50 text-xs text-blue-100 flex gap-2">
                <Sparkles className="w-4 h-4 text-blue-400 shrink-0" /> {result.summary}
              </div>
            )}
            {Object.entries(result.errors || {}).map(([s, m]) => (
              <div key={s} className="text-[11px] text-amber-300">{s}: {m}</div>
            ))}
            <div className="divide-y divide-slate-800/70">
              {result.results.map((r, i) => {
                const Icon = iconFor(r.source);
                return (
                  <div key={i} className="py-2.5 flex items-start gap-3">
                    <Icon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-200 flex items-center gap-2">
                        <span className="truncate">{r.title}</span>
                        {r.simulated && <Badge variant="warning" className="text-[9px]">demo</Badge>}
                      </div>
                      {r.snippet && <div className="text-[11px] text-slate-500 line-clamp-2">{r.snippet}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.date && <span className="text-[10px] text-slate-500">{formatDate(r.date)}</span>}
                      {r.url && r.url !== '#' && <a href={r.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink className="w-3.5 h-3.5" /></a>}
                    </div>
                  </div>
                );
              })}
              {!result.results.length && <p className="text-xs text-slate-500 py-3">No results.</p>}
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Ask your documents (RAG)</CardTitle>
              <CardDescription>Retrieves the most relevant chunks, then Gemini answers with citations.</CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={ask} className="flex gap-2">
            <input className={input} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What is the budget and timeline for Project Alpha?" />
            <Button type="submit" isLoading={asking}>Ask</Button>
          </form>
          {answer && (
            <div className="mt-4 space-y-3">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 whitespace-pre-line leading-relaxed">
                {answer.answer}
                {answer.isSimulated && <div className="text-[10px] text-amber-400 mt-2">Heuristic answer (no Gemini key) — showing the best-matching passage.</div>}
              </div>
              <div className="space-y-1.5">
                {(answer.sources || []).map((s: any, i: number) => (
                  <div key={i} className="text-[11px] text-slate-400 p-2 rounded bg-slate-950/60 border border-slate-800">
                    <span className="text-blue-300 font-semibold">[{i + 1}] {s.title}</span> <span className="text-slate-600">· {s.method} score {s.score}</span>
                    <div className="line-clamp-2 mt-0.5">{s.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Indexed documents</CardTitle>
              <CardDescription>{docs.length} document(s)</CardDescription>
            </div>
            <div className="flex gap-1.5">
              <label className="cursor-pointer">
                <input type="file" accept=".pdf,.txt,.md,.csv,.json,.html" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white">
                  {uploading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Upload
                </span>
              </label>
              <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}><Plus className="w-3 h-3" /></Button>
            </div>
          </CardHeader>
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d._id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="min-w-0">
                  <div className="text-xs text-slate-200 truncate">{d.title}</div>
                  <div className="text-[10px] text-slate-500">{d.source} · {d.chunkCount} chunks · {d.embedded ? 'vector embeddings' : 'keyword index'}</div>
                </div>
                <button onClick={async () => { await api.deleteKnowledge(d._id); loadDocs(); }} className="text-slate-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {!docs.length && <p className="text-xs text-slate-500">Upload a PDF/TXT/MD or import a Google Drive / Notion document.</p>}
          </div>
        </Card>
      </div>

      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add to knowledge base" maxWidth="md">
        <div className="space-y-3 text-xs">
          <div className="flex gap-2">
            {(['text', 'drive', 'notion'] as const).map((k) => (
              <button key={k} onClick={() => setImportKind(k)} className={`px-3 py-1.5 rounded-lg border ${importKind === k ? 'border-blue-500 text-blue-200 bg-blue-600/15' : 'border-slate-800 text-slate-400'}`}>
                {k === 'text' ? 'Paste text' : k === 'drive' ? 'Google Drive file' : 'Notion page'}
              </button>
            ))}
          </div>
          {importKind === 'text' && <input className={input} placeholder="Title" value={importTitle} onChange={(e) => setImportTitle(e.target.value)} />}
          {importKind === 'text' ? (
            <textarea className={`${input} h-40`} placeholder="Paste document text…" value={importValue} onChange={(e) => setImportValue(e.target.value)} />
          ) : (
            <input className={input} placeholder={importKind === 'drive' ? 'Drive file ID (from the file URL, or from Smart Search results)' : 'Notion page ID (last part of the page URL)'} value={importValue} onChange={(e) => setImportValue(e.target.value)} />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={importDoc} isLoading={uploading} disabled={!importValue || (importKind === 'text' && !importTitle)}>Index document</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
