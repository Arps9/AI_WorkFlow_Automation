import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { googleAuthService } from './google-auth.service';
import { env } from '../../config/env.config';
import { NotConnectedError, IntegrationError } from '../integrations/http';
import { DEMO_DRIVE_FILES, DEMO_KNOWLEDGE_DOC } from '../integrations/demo';
import { extractTextFromBuffer } from '../knowledge/text-extract';

const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,size,owners(displayName),parents)';

function mapFile(f: drive_v3.Schema$File) {
  return { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: f.webViewLink, size: f.size ? Number(f.size) : undefined, owner: f.owners?.[0]?.displayName };
}

const escapeQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

class DriveService {
  private async drive(userId: string) {
    const auth = await googleAuthService.getClient(userId, 'drive');
    if (!auth) {
      if (!env.DEMO_MODE) throw new NotConnectedError('drive');
      return null;
    }
    return google.drive({ version: 'v3', auth });
  }

  public async searchFiles(userId: string, p: { query?: string; mimeType?: string; folderId?: string; limit?: number }) {
    const drive = await this.drive(userId);
    if (!drive) {
      const q = (p.query || '').toLowerCase();
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      return { files: DEMO_DRIVE_FILES.filter((f) => !words.length || words.some((w) => f.name.toLowerCase().includes(w))), simulated: true };
    }
    const parts = ['trashed = false'];
    if (p.query) parts.push(`(name contains '${escapeQ(p.query)}' or fullText contains '${escapeQ(p.query)}')`);
    if (p.mimeType) parts.push(`mimeType = '${escapeQ(p.mimeType)}'`);
    if (p.folderId) parts.push(`'${escapeQ(p.folderId)}' in parents`);
    const r = await drive.files.list({ q: parts.join(' and '), pageSize: p.limit || 15, orderBy: p.query ? undefined : 'modifiedTime desc', fields: FIELDS });
    return { files: (r.data.files || []).map(mapFile) };
  }

  public async latestFile(userId: string, query: string) {
    const r = await this.searchFiles(userId, { query, limit: 1 });
    return { file: r.files[0] || null, simulated: (r as any).simulated };
  }

  /** Reads a file as plain text: Google Docs/Sheets/Slides are exported, PDFs parsed, text files read. */
  public async readFileText(userId: string, fileId: string): Promise<{ name: string; text: string; mimeType?: string; webViewLink?: string; simulated?: boolean }> {
    const drive = await this.drive(userId);
    if (!drive) {
      const f = DEMO_DRIVE_FILES.find((x) => x.id === fileId) || DEMO_DRIVE_FILES[0];
      return { name: f.name, text: DEMO_KNOWLEDGE_DOC.text, mimeType: f.mimeType, webViewLink: '#', simulated: true };
    }
    const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType,webViewLink,size' });
    const mime = meta.data.mimeType || '';
    let text = '';
    if (mime === 'application/vnd.google-apps.document' || mime === 'application/vnd.google-apps.presentation') {
      const r = await drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
      text = String(r.data);
    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      const r = await drive.files.export({ fileId, mimeType: 'text/csv' }, { responseType: 'text' });
      text = String(r.data);
    } else if (mime.startsWith('application/vnd.google-apps')) {
      throw new IntegrationError('drive', `Cannot extract text from ${mime}`, 400);
    } else {
      if (Number(meta.data.size || 0) > 15 * 1024 * 1024) throw new IntegrationError('drive', 'File too large (>15 MB)', 400);
      const r = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
      text = await extractTextFromBuffer(Buffer.from(r.data as ArrayBuffer), mime, meta.data.name || '');
    }
    return { name: meta.data.name || 'Untitled', text, mimeType: mime, webViewLink: meta.data.webViewLink || undefined };
  }

  public async uploadFile(userId: string, p: { name: string; content: Buffer | string; mimeType?: string; folderId?: string; folderName?: string }) {
    const drive = await this.drive(userId);
    if (!drive) return { status: 'uploaded', file: { id: `drv-demo-${Date.now()}`, name: p.name, webViewLink: '#' }, message: `Simulated upload of "${p.name}" to Drive${p.folderName ? `/${p.folderName}` : ''}`, simulated: true };
    let parent = p.folderId;
    if (!parent && p.folderName) parent = (await this.ensureFolder(userId, p.folderName)).id || undefined;
    const body = typeof p.content === 'string' ? Buffer.from(p.content) : p.content;
    const r = await drive.files.create({
      requestBody: { name: p.name, parents: parent ? [parent] : undefined },
      media: { mimeType: p.mimeType || 'application/octet-stream', body: Readable.from(body) },
      fields: 'id,name,webViewLink,mimeType',
    });
    return { status: 'uploaded', file: mapFile(r.data), message: `Uploaded "${p.name}" to Google Drive` };
  }

  public async ensureFolder(userId: string, name: string): Promise<{ id?: string | null; name: string; created: boolean; simulated?: boolean }> {
    const drive = await this.drive(userId);
    if (!drive) return { id: `drv-folder-${name}`, name, created: false, simulated: true };
    const existing = await drive.files.list({ q: `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeQ(name)}' and trashed = false`, fields: 'files(id,name)', pageSize: 1 });
    if (existing.data.files?.[0]) return { id: existing.data.files[0].id, name, created: false };
    const r = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id,name' });
    return { id: r.data.id, name, created: true };
  }

  public async moveFile(userId: string, p: { fileId: string; folderName: string }) {
    const drive = await this.drive(userId);
    if (!drive) return { status: 'moved', fileId: p.fileId, folder: p.folderName, message: `Simulated move to "${p.folderName}"`, simulated: true };
    const folder = await this.ensureFolder(userId, p.folderName);
    const file = await drive.files.get({ fileId: p.fileId, fields: 'parents,name' });
    await drive.files.update({ fileId: p.fileId, addParents: folder.id || undefined, removeParents: (file.data.parents || []).join(','), fields: 'id,parents' });
    return { status: 'moved', fileId: p.fileId, folder: p.folderName, message: `Moved "${file.data.name}" to "${p.folderName}"` };
  }

  public async downloadFile(userId: string, fileId: string): Promise<{ name: string; mimeType: string; data: Buffer }> {
    const drive = await this.drive(userId);
    if (!drive) return { name: 'demo.txt', mimeType: 'text/plain', data: Buffer.from(DEMO_KNOWLEDGE_DOC.text) };
    const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
    const mime = meta.data.mimeType || 'application/octet-stream';
    if (mime.startsWith('application/vnd.google-apps')) {
      const r = await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
      return { name: `${meta.data.name}.pdf`, mimeType: 'application/pdf', data: Buffer.from(r.data as ArrayBuffer) };
    }
    const r = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return { name: meta.data.name || 'file', mimeType: mime, data: Buffer.from(r.data as ArrayBuffer) };
  }
}

export const driveService = new DriveService();
