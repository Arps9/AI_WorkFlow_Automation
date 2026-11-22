import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.config';
import { logger } from '../../utils/logger';
import { AIProvider } from './ai.provider';

/**
 * Thin Gemini wrapper using the current @google/genai SDK.
 * - Model is configurable (GEMINI_MODEL). If the configured model is retired/unknown,
 *   we automatically fall back through a list of known aliases.
 * - Retries once on 429/503 (free-tier rate limits).
 * - Returns null on failure so callers can use deterministic fallbacks.
 */
export class GeminiProvider implements AIProvider {
  public readonly name = 'Gemini';
  private client: GoogleGenAI | null = null;
  private modelCandidates: string[];
  private activeModel: string;
  private embeddingCandidates: string[];
  private lastError: string | null = null;

  constructor(apiKey: string = env.GEMINI_API_KEY) {
    this.modelCandidates = Array.from(
      new Set([env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'].filter(Boolean))
    );
    this.activeModel = this.modelCandidates[0];
    this.embeddingCandidates = Array.from(new Set([env.GEMINI_EMBEDDING_MODEL, 'gemini-embedding-001', 'gemini-embedding-2']));

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      logger.info(`Gemini provider initialized (model: ${this.activeModel})`);
    } else {
      logger.warn('GEMINI_API_KEY not set — AI features use deterministic heuristic fallbacks.');
    }
  }

  public isLive(): boolean {
    return Boolean(this.client);
  }

  public getModelName(): string {
    return this.activeModel;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  private static cleanJson(raw: string): string {
    let s = raw.trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const first = s.search(/[\[{]/);
    const lastObj = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (first > 0 && lastObj > first) s = s.slice(first, lastObj + 1);
    return s.trim();
  }

  private static isModelNotFound(err: any): boolean {
    const msg = String(err?.message || err);
    return /not found|404|is not supported|no longer available|deprecated/i.test(msg);
  }

  private static isRetryable(err: any): boolean {
    const msg = String(err?.message || err);
    return /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(msg);
  }

  private async callModel(prompt: string, json: boolean): Promise<string | null> {
    if (!this.client) return null;
    const startIdx = Math.max(0, this.modelCandidates.indexOf(this.activeModel));
    const ordered = [...this.modelCandidates.slice(startIdx), ...this.modelCandidates.slice(0, startIdx)];

    for (const model of ordered) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await this.client.models.generateContent({
            model,
            contents: prompt,
            config: json ? { responseMimeType: 'application/json', temperature: 0.2 } : { temperature: 0.4 },
          });
          if (model !== this.activeModel) {
            logger.warn(`Gemini model switched to "${model}" (configured "${this.activeModel}" unavailable)`);
            this.activeModel = model;
          }
          this.lastError = null;
          return res.text ?? '';
        } catch (err: any) {
          this.lastError = err?.message || String(err);
          if (GeminiProvider.isRetryable(err) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          }
          if (GeminiProvider.isModelNotFound(err)) break; // try next model
          logger.warn(`Gemini call failed: ${this.lastError}`);
          return null;
        }
      }
    }
    return null;
  }

  public async generateJSON<T>(prompt: string, validate: (raw: any) => T): Promise<T | null> {
    const text = await this.callModel(prompt, true);
    if (text === null) return null;
    try {
      return validate(JSON.parse(GeminiProvider.cleanJson(text)));
    } catch (err: any) {
      logger.warn(`Gemini JSON validation failed: ${err.message}`);
      return null;
    }
  }

  public async generateText(prompt: string): Promise<string | null> {
    return this.callModel(prompt, false);
  }

  public async embed(texts: string[]): Promise<number[][] | null> {
    if (!this.client || texts.length === 0) return null;
    for (const model of this.embeddingCandidates) {
      try {
        const out: number[][] = [];
        // batch in groups of 50 to stay under request limits
        for (let i = 0; i < texts.length; i += 50) {
          const batch = texts.slice(i, i + 50);
          const res = await this.client.models.embedContent({ model, contents: batch });
          const vectors = (res.embeddings || []).map((e) => e.values || []);
          if (vectors.length !== batch.length) throw new Error('Embedding count mismatch');
          out.push(...vectors);
        }
        return out;
      } catch (err: any) {
        this.lastError = err?.message || String(err);
        if (GeminiProvider.isModelNotFound(err)) continue;
        logger.warn(`Gemini embedding failed: ${this.lastError}`);
        return null;
      }
    }
    return null;
  }
}
