import { Request, Response } from 'express';
import { knowledgeService } from '../services/knowledge/knowledge.service';
import { extractTextFromBuffer } from '../services/knowledge/text-extract';
import { driveService } from '../services/google/drive.service';
import { notionService } from '../services/notion/notion.service';
import { searchService, SearchSource, ALL_SOURCES } from '../services/search/search.service';
import { audit } from '../services/audit/audit.service';

export class KnowledgeController {
  static async list(req: Request, res: Response) {
    res.json({ success: true, documents: await knowledgeService.list(req.user!.id) });
  }

  static async upload(req: Request, res: Response) {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: { message: 'Attach a file in the "file" field', statusCode: 400 } });
    const text = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);
    const doc = await knowledgeService.ingest(req.user!.id, { title: req.body.title || file.originalname, text, source: 'upload', mimeType: file.mimetype });
    audit({ userId: req.user!.id, action: 'knowledge.ingest', resource: String(doc._id), status: 'success', details: { title: doc.title, source: 'upload' } });
    res.status(201).json({ success: true, document: doc });
  }

  static async addText(req: Request, res: Response) {
    const { title, text } = req.body;
    if (!title || !text) return res.status(400).json({ success: false, error: { message: 'title and text are required', statusCode: 400 } });
    const doc = await knowledgeService.ingest(req.user!.id, { title, text, source: 'manual' });
    res.status(201).json({ success: true, document: doc });
  }

  static async importDrive(req: Request, res: Response) {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ success: false, error: { message: 'fileId is required', statusCode: 400 } });
    const f = await driveService.readFileText(req.user!.id, fileId);
    const doc = await knowledgeService.ingest(req.user!.id, { title: f.name, text: f.text, source: f.simulated ? 'demo' : 'drive', sourceId: fileId, url: f.webViewLink, mimeType: f.mimeType });
    res.status(201).json({ success: true, document: doc });
  }

  static async importNotion(req: Request, res: Response) {
    const { pageId } = req.body;
    if (!pageId) return res.status(400).json({ success: false, error: { message: 'pageId is required', statusCode: 400 } });
    const p = await notionService.getPageText(req.user!.id, pageId);
    const doc = await knowledgeService.ingest(req.user!.id, { title: p.title, text: p.text, source: 'notion', sourceId: pageId, url: p.url });
    res.status(201).json({ success: true, document: doc });
  }

  static async remove(req: Request, res: Response) {
    await knowledgeService.remove(req.user!.id, req.params.id);
    res.json({ success: true });
  }

  static async ask(req: Request, res: Response) {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, error: { message: 'question is required', statusCode: 400 } });
    res.json({ success: true, ...(await knowledgeService.ask(req.user!.id, question)) });
  }
}

export class SearchController {
  static async search(req: Request, res: Response) {
    const q = String(req.query.q || req.body?.query || '').trim();
    if (!q) return res.status(400).json({ success: false, error: { message: 'q is required', statusCode: 400 } });
    const sources = String(req.query.sources || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is SearchSource => (ALL_SOURCES as string[]).includes(s));
    res.json({ success: true, ...(await searchService.search(req.user!.id, q, { sources, summarize: req.query.summarize !== 'false' })) });
  }
}
