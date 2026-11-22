import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { WorkflowModel } from '../models/workflow.model';
import { UserModel } from '../models/user.model';
import { KnowledgeDocumentModel } from '../models/knowledge.model';
import { WORKFLOW_TEMPLATES } from './workflow-templates';
import { DEMO_KNOWLEDGE_DOC } from '../services/integrations/demo';
import { knowledgeService } from '../services/knowledge/knowledge.service';
import { env } from '../config/env.config';
import { logger } from './logger';

/** One-off fixes for databases created by the previous version of the project. */
async function migrate() {
  const db = mongoose.connection.db;
  if (!db) return;
  // v1 had a global unique index on messageId; v2 scopes analyses per user
  await db.collection('emailanalyses').dropIndex('messageId_1').then(() => logger.info('Migration: dropped legacy emailanalyses.messageId_1 index')).catch(() => null);
  // v1 rows had no owner — they belonged to the single demo user
  await db.collection('emailanalyses').deleteMany({ userId: { $exists: false } }).catch(() => null);
  await db.collection('aiconversations').deleteMany({ userId: 'default-enterprise-user' }).catch(() => null);
  await db.collection('connectedaccounts').deleteMany({ userId: 'default-enterprise-user' }).catch(() => null);
}

export async function seedDatabaseIfEmpty(): Promise<void> {
  try {
    await migrate();

    // 1. Demo admin (only when the database has no users yet)
    if ((await UserModel.countDocuments()) === 0) {
      await UserModel.create({ name: 'Demo Admin', email: env.DEMO_ADMIN_EMAIL, passwordHash: await bcrypt.hash(env.DEMO_ADMIN_PASSWORD, 10), role: 'admin' });
      logger.info(`Seeded admin account → ${env.DEMO_ADMIN_EMAIL} / ${env.DEMO_ADMIN_PASSWORD}  (change this password after first login)`);
    }

    // 2. System workflow templates (upserted by title so improvements ship on restart)
    const titles = WORKFLOW_TEMPLATES.map((t) => t.title);
    for (const t of WORKFLOW_TEMPLATES) {
      await WorkflowModel.updateOne({ title: t.title, isTemplate: true, createdBy: 'system' }, { $set: { ...t, isTemplate: true, isActive: true, createdBy: 'system' } }, { upsert: true });
    }
    const removed = await WorkflowModel.deleteMany({ isTemplate: true, createdBy: 'system', title: { $nin: titles } });
    if (removed.deletedCount) logger.info(`Removed ${removed.deletedCount} outdated workflow template(s)`);
    // v1 templates were stored with createdBy "system" but without isTemplate in some DBs
    await WorkflowModel.deleteMany({ createdBy: 'system', isTemplate: { $ne: true } });
    logger.info(`Workflow templates ready (${WORKFLOW_TEMPLATES.length})`);

    // 3. Demo knowledge-base document for the admin so RAG search works out of the box
    if (env.DEMO_MODE) {
      const admin = await UserModel.findOne({ email: env.DEMO_ADMIN_EMAIL });
      if (admin && !(await KnowledgeDocumentModel.exists({ userId: String(admin._id), source: 'demo' }))) {
        await knowledgeService.ingest(String(admin._id), { title: DEMO_KNOWLEDGE_DOC.title, text: DEMO_KNOWLEDGE_DOC.text, source: 'demo', sourceId: 'demo-project-alpha' });
      }
    }
  } catch (err: any) {
    logger.warn('Database seeding notice', { error: err.message });
  }
}
