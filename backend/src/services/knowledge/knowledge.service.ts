import { KnowledgeDocumentModel, DocumentChunkModel, KnowledgeSource } from '../../models/knowledge.model';
import { aiService } from '../ai/ai.service';
import { logger } from '../../utils/logger';

/**
 * Retrieval-Augmented Generation (RAG) over the user's documents.
 * Pipeline: extract text → chunk (~900 chars, 150 overlap) → Gemini embeddings → store in MongoDB
 *           query → embed → cosine similarity top-k → Gemini answers with [n] citations.
 * Without a Gemini key, retrieval falls back to keyword (TF-IDF-style) scoring.
 */

export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length <= size) {
      current = current ? `${current}\n\n${p}` : p;
      continue;
    }
    if (current) chunks.push(current);
    if (p.length <= size) {
      current = p;
    } else {
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size));
      current = '';
    }
  }
  if (current) chunks.push(current);
  // add a little overlap between paragraph-built chunks for context continuity
  return chunks.map((c, i) => (i > 0 && overlap > 0 ? `${chunks[i - 1].slice(-overlap)} ${c}` : c));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const STOP = new Set('the a an and or of to in on for with is are was were be by at as it this that from what which who how when where do does did about related find show me my our'.split(' '));
const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

class KnowledgeService {
  public async ingest(userId: string, doc: { title: string; text: string; source: KnowledgeSource; sourceId?: string; url?: string; mimeType?: string }) {
    const text = (doc.text || '').trim();
    if (text.length < 20) throw new Error('Document has no extractable text');

    if (doc.sourceId) {
      const old = await KnowledgeDocumentModel.find({ userId, source: doc.source, sourceId: doc.sourceId });
      for (const o of old) await this.remove(userId, String(o._id));
    }

    const chunks = chunkText(text);
    const vectors = await aiService.embed(chunks.map((c) => `${doc.title}\n${c}`));
    const kd = await KnowledgeDocumentModel.create({
      userId,
      title: doc.title,
      source: doc.source,
      sourceId: doc.sourceId,
      url: doc.url,
      mimeType: doc.mimeType,
      chunkCount: chunks.length,
      charCount: text.length,
      embedded: Boolean(vectors),
    });
    await DocumentChunkModel.insertMany(
      chunks.map((c, i) => ({ userId, documentId: String(kd._id), documentTitle: doc.title, index: i, text: c, embedding: vectors?.[i] }))
    );
    logger.info(`Indexed "${doc.title}" (${chunks.length} chunks, embeddings: ${Boolean(vectors)})`);
    return kd;
  }

  public async list(userId: string) {
    return KnowledgeDocumentModel.find({ userId }).sort({ createdAt: -1 });
  }

  public async remove(userId: string, documentId: string) {
    await DocumentChunkModel.deleteMany({ userId, documentId });
    await KnowledgeDocumentModel.deleteOne({ userId, _id: documentId });
  }

  public async retrieve(userId: string, query: string, k = 5) {
    const chunks = await DocumentChunkModel.find({ userId }).limit(5000).lean();
    if (!chunks.length) return [];

    const withVectors = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length);
    if (withVectors.length) {
      const qv = (await aiService.embed([query]))?.[0];
      if (qv) {
        return withVectors
          .map((c) => ({ chunk: c, score: cosine(qv, c.embedding as number[]) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map(({ chunk, score }) => ({ documentId: chunk.documentId, title: chunk.documentTitle || 'Document', text: chunk.text, score: Number(score.toFixed(4)), method: 'embedding' as const }));
      }
    }

    // keyword fallback with IDF weighting
    const qTerms = Array.from(new Set(tokenize(query)));
    if (!qTerms.length) return [];
    const df: Record<string, number> = {};
    const tokenized = chunks.map((c) => {
      const toks = tokenize(`${c.documentTitle} ${c.text}`);
      new Set(toks).forEach((t) => (df[t] = (df[t] || 0) + 1));
      return toks;
    });
    return chunks
      .map((c, i) => {
        const toks = tokenized[i];
        let score = 0;
        for (const t of qTerms) {
          const tf = toks.filter((x) => x === t).length;
          if (tf) score += (1 + Math.log(tf)) * Math.log(1 + chunks.length / (df[t] || 1));
        }
        return { chunk: c, score: score / Math.sqrt(toks.length || 1) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ chunk, score }) => ({ documentId: chunk.documentId, title: chunk.documentTitle || 'Document', text: chunk.text, score: Number(score.toFixed(4)), method: 'keyword' as const }));
  }

  public async ask(userId: string, question: string) {
    const passages = await this.retrieve(userId, question, 5);
    const answer = await aiService.answerWithContext(question, passages);
    return { question, ...answer, sources: passages };
  }
}

export const knowledgeService = new KnowledgeService();
