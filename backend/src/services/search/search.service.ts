import { gmailService } from '../gmail/gmail.service';
import { driveService } from '../google/drive.service';
import { jiraService } from '../jira/jira.service';
import { githubService } from '../github/github.service';
import { notionService } from '../notion/notion.service';
import { knowledgeService } from '../knowledge/knowledge.service';
import { aiService } from '../ai/ai.service';
import { logger } from '../../utils/logger';

export interface SearchResult {
  source: 'gmail' | 'drive' | 'jira' | 'github' | 'notion' | 'knowledge';
  title: string;
  snippet?: string;
  url?: string;
  id?: string;
  date?: string;
  simulated?: boolean;
}

export type SearchSource = SearchResult['source'];
export const ALL_SOURCES: SearchSource[] = ['gmail', 'drive', 'jira', 'github', 'notion', 'knowledge'];

/** Natural-language search across every connected tool in parallel. */
class SearchService {
  public async search(userId: string, query: string, opts: { sources?: SearchSource[]; summarize?: boolean } = {}) {
    const sources = opts.sources?.length ? opts.sources : ALL_SOURCES;
    const keywords = query.replace(/\b(find|search|show|me|all|documents?|files?|related to|about|regarding|anything|for)\b/gi, ' ').replace(/\s+/g, ' ').trim() || query;
    const errors: Record<string, string> = {};

    const runners: Record<SearchSource, () => Promise<SearchResult[]>> = {
      gmail: async () => {
        const msgs = await gmailService.searchMessages(keywords, userId, 8);
        return msgs.map((m) => ({ source: 'gmail' as const, id: m.id, title: m.subject, snippet: `${m.senderName || m.sender}: ${m.snippet}`, date: new Date(m.date).toISOString(), simulated: m.isDemoData }));
      },
      drive: async () => {
        const r: any = await driveService.searchFiles(userId, { query: keywords, limit: 8 });
        return r.files.map((f: any) => ({ source: 'drive' as const, id: f.id, title: f.name, snippet: f.mimeType, url: f.webViewLink, date: f.modifiedTime, simulated: r.simulated }));
      },
      jira: async () => {
        const safe = keywords.replace(/["\\]/g, '');
        const r: any = await jiraService.searchIssues(userId, { jql: `text ~ "${safe}" ORDER BY updated DESC`, maxResults: 8 });
        const issues = r.simulated ? r.issues.filter((i: any) => keywords.toLowerCase().split(' ').some((w: string) => w.length > 2 && i.summary.toLowerCase().includes(w))) : r.issues;
        return issues.map((i: any) => ({ source: 'jira' as const, id: i.key, title: `${i.key}: ${i.summary}`, snippet: `${i.status} • ${i.priority || ''}`, url: i.url, date: i.updated, simulated: r.simulated }));
      },
      github: async () => {
        const r: any = await githubService.searchIssues(userId, keywords);
        return r.items.map((i: any) => ({ source: 'github' as const, id: String(i.number), title: `${i.isPR ? 'PR' : 'Issue'} #${i.number}: ${i.title}`, snippet: i.state, url: i.url, simulated: r.simulated }));
      },
      notion: async () => {
        const r: any = await notionService.search(userId, { query: keywords, limit: 8 });
        return r.pages.map((p: any) => ({ source: 'notion' as const, id: p.id, title: p.title, url: p.url, date: p.lastEdited, simulated: r.simulated }));
      },
      knowledge: async () => {
        const r = await knowledgeService.retrieve(userId, query, 5);
        return r.map((x) => ({ source: 'knowledge' as const, id: x.documentId, title: x.title, snippet: x.text.slice(0, 220) }));
      },
    };

    const settled = await Promise.allSettled(sources.map((s) => runners[s]()));
    const results: SearchResult[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') results.push(...r.value);
      else {
        errors[sources[i]] = r.reason?.message || String(r.reason);
        logger.warn(`Smart search: ${sources[i]} failed`, { error: errors[sources[i]] });
      }
    });

    const counts = results.reduce<Record<string, number>>((acc, r) => ((acc[r.source] = (acc[r.source] || 0) + 1), acc), {});
    const summary = opts.summarize !== false ? (await aiService.summarizeSearch(query, results)).summary : undefined;
    return { query, keywords, total: results.length, counts, summary, results, errors };
  }
}

export const searchService = new SearchService();
