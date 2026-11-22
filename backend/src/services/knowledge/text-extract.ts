// pdf-parse's index.js runs a self-test when imported directly; import the library file instead.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (data: Buffer) => Promise<{ text: string }> = require('pdf-parse/lib/pdf-parse.js');

export async function extractTextFromBuffer(buf: Buffer, mimeType: string, filename = ''): Promise<string> {
  const name = filename.toLowerCase();
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    const r = await pdfParse(buf);
    return r.text || '';
  }
  if (mimeType.startsWith('text/') || /\.(txt|md|csv|json|log|html?)$/.test(name) || mimeType === 'application/json') {
    const s = buf.toString('utf8');
    return /\.html?$/.test(name) || mimeType === 'text/html' ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : s;
  }
  throw new Error(`Unsupported file type for text extraction: ${mimeType || filename}. Use PDF, TXT, MD, CSV or Google Docs.`);
}
