import mongoose, { Document, Schema } from 'mongoose';

export type KnowledgeSource = 'upload' | 'drive' | 'notion' | 'gmail' | 'manual' | 'demo';

export interface IKnowledgeDocument extends Document {
  userId: string;
  title: string;
  source: KnowledgeSource;
  sourceId?: string;
  url?: string;
  mimeType?: string;
  chunkCount: number;
  charCount: number;
  embedded: boolean; // true when vector embeddings were generated
  createdAt: Date;
  updatedAt: Date;
}

export interface IDocumentChunk extends Document {
  userId: string;
  documentId: string;
  documentTitle: string;
  index: number;
  text: string;
  embedding?: number[];
}

const KnowledgeDocumentSchema = new Schema<IKnowledgeDocument>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    source: { type: String, enum: ['upload', 'drive', 'notion', 'gmail', 'manual', 'demo'], default: 'upload' },
    sourceId: { type: String },
    url: { type: String },
    mimeType: { type: String },
    chunkCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    embedded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const DocumentChunkSchema = new Schema<IDocumentChunk>({
  userId: { type: String, required: true, index: true },
  documentId: { type: String, required: true, index: true },
  documentTitle: { type: String },
  index: { type: Number, required: true },
  text: { type: String, required: true },
  embedding: { type: [Number], default: undefined },
});

export const KnowledgeDocumentModel =
  (mongoose.models.KnowledgeDocument as mongoose.Model<IKnowledgeDocument>) ||
  mongoose.model<IKnowledgeDocument>('KnowledgeDocument', KnowledgeDocumentSchema);

export const DocumentChunkModel =
  (mongoose.models.DocumentChunk as mongoose.Model<IDocumentChunk>) ||
  mongoose.model<IDocumentChunk>('DocumentChunk', DocumentChunkSchema);
