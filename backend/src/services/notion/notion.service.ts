import { getCredentials, NotionCreds } from '../integrations/credentials.service';
import { httpJSON, IntegrationError } from '../integrations/http';
import { liveOrDemo, DEMO_NOTION_PAGES } from '../integrations/demo';

const API = 'https://api.notion.com/v1';
const h = (c: NotionCreds) => ({ Authorization: `Bearer ${c.apiKey}`, 'Notion-Version': '2022-06-28' });

const rich = (text: string) => [{ type: 'text', text: { content: text.slice(0, 1900) } }];

/** Minimal markdown → Notion blocks: #/##/### headings, -/* bullets, [ ] to-dos, paragraphs. */
export function markdownToBlocks(md: string): any[] {
  const blocks: any[] = [];
  for (const raw of (md || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^###\s+(.*)/))) blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(m[1]) } });
    else if ((m = line.match(/^##\s+(.*)/))) blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(m[1]) } });
    else if ((m = line.match(/^#\s+(.*)/))) blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rich(m[1]) } });
    else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: rich(m[2]), checked: m[1].toLowerCase() === 'x' } });
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(m[1]) } });
    else blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(line) } });
  }
  return blocks.slice(0, 100); // Notion API limit per request
}

function pageTitle(page: any): string {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    if (props[key]?.type === 'title') return (props[key].title || []).map((t: any) => t.plain_text).join('') || 'Untitled';
  }
  return page.title?.map?.((t: any) => t.plain_text).join('') || 'Untitled';
}

function blockText(b: any): string {
  const v = b[b.type];
  const t = (v?.rich_text || []).map((r: any) => r.plain_text).join('');
  if (b.type?.startsWith('heading')) return `\n${t}\n`;
  if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item' || b.type === 'to_do') return `- ${t}`;
  return t;
}

class NotionService {
  private async creds(userId: string) {
    return (await getCredentials(userId, 'notion'))?.creds || null;
  }

  public async testConnection(creds: NotionCreds) {
    const me = await httpJSON<any>('notion', `${API}/users/me`, { headers: h(creds) });
    return { accountName: me.name || me.bot?.workspace_name || 'Notion integration', metadata: { botId: me.id, workspace: me.bot?.workspace_name } };
  }

  private async parentId(c: NotionCreds, given?: string): Promise<string> {
    const id = (given || c.parentPageId || '').replace(/^.*-([0-9a-f]{32})$/i, '$1').replace(/[^0-9a-f-]/gi, '');
    if (id) return id;
    // Fall back to the first page shared with the integration
    const r = await httpJSON<any>('notion', `${API}/search`, { method: 'POST', headers: h(c), body: { filter: { property: 'object', value: 'page' }, page_size: 1 } });
    const first = r.results?.[0]?.id;
    if (!first) throw new IntegrationError('notion', 'No parent page. Share a Notion page with the integration (⋯ → Connections) or set a parent page ID.', 400);
    return first;
  }

  public async createPage(userId: string, p: { title: string; content?: string; parentPageId?: string }) {
    return liveOrDemo('notion', await this.creds(userId), async (c) => {
      const parent = await this.parentId(c, p.parentPageId);
      const r = await httpJSON<any>('notion', `${API}/pages`, {
        method: 'POST',
        headers: h(c),
        body: { parent: { page_id: parent }, properties: { title: { title: rich(p.title || 'Untitled') } }, children: markdownToBlocks(p.content || '') },
      });
      return { status: 'created', pageId: r.id, url: r.url, title: p.title, message: `Created Notion page "${p.title}"` };
    }, () => ({ status: 'created', pageId: `ntn-demo-${Date.now()}`, url: '#', title: p.title, message: `Simulated Notion page "${p.title}"`, preview: (p.content || '').slice(0, 400) }));
  }

  public async search(userId: string, p: { query: string; limit?: number }) {
    return liveOrDemo('notion', await this.creds(userId), async (c) => {
      const r = await httpJSON<any>('notion', `${API}/search`, { method: 'POST', headers: h(c), body: { query: p.query, page_size: p.limit || 10, filter: { property: 'object', value: 'page' } } });
      return { pages: (r.results || []).map((x: any) => ({ id: x.id, title: pageTitle(x), url: x.url, lastEdited: x.last_edited_time })) };
    }, () => ({ pages: DEMO_NOTION_PAGES.filter((x) => !p.query || x.title.toLowerCase().includes(p.query.toLowerCase().split(' ')[0])) }));
  }

  public async getPageText(userId: string, pageId: string): Promise<{ title: string; text: string; url?: string }> {
    const c = await this.creds(userId);
    if (!c) {
      const demo = DEMO_NOTION_PAGES.find((x) => x.id === pageId) || DEMO_NOTION_PAGES[0];
      return { title: demo.title, text: `${demo.title}\n- Owners: Priya (eng lead), Rahul (backend)\n- Decision: use MongoDB for workflow state, Redis later for queues\n- Next review in two weeks`, url: '#' };
    }
    const page = await httpJSON<any>('notion', `${API}/pages/${pageId}`, { headers: h(c) });
    const lines: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await httpJSON<any>('notion', `${API}/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, { headers: h(c) });
      (r.results || []).forEach((b: any) => lines.push(blockText(b)));
      if (!r.has_more) break;
      cursor = r.next_cursor;
    }
    return { title: pageTitle(page), text: lines.join('\n'), url: page.url };
  }
}

export const notionService = new NotionService();
