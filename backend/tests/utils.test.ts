import { encrypt, decrypt, encryptJSON, decryptJSON } from '../src/utils/crypto';
import { parseNaturalDateTime, addMinutesLocal } from '../src/utils/date-parse';
import { chunkText } from '../src/services/knowledge/knowledge.service';
import { markdownToBlocks } from '../src/services/notion/notion.service';
import { toADF } from '../src/services/jira/jira.service';

describe('Utilities', () => {
  it('encrypts credentials with AES-256-GCM', () => {
    const c = encrypt('xoxb-secret');
    expect(c).not.toContain('xoxb');
    expect(decrypt(c)).toBe('xoxb-secret');
    expect(decryptJSON(encryptJSON({ a: 1 }))).toEqual({ a: 1 });
  });

  it('parses natural-language times', () => {
    expect(parseNaturalDateTime('tomorrow at 2 PM')!.local).toMatch(/T14:00:00$/);
    expect(parseNaturalDateTime('today 9:30')!.local).toMatch(/T09:30:00$/);
    expect(parseNaturalDateTime('random words')).toBeNull();
    expect(addMinutesLocal('2026-11-21T23:30:00', 60)).toBe('2026-11-22T00:30:00');
  });

  it('chunks long documents', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + 'lorem ipsum '.repeat(10)).join('\n\n');
    const chunks = chunkText(text, 500, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
  });

  it('converts markdown to Notion blocks and text to Jira ADF', () => {
    const blocks = markdownToBlocks('# Title\n- item\n- [ ] todo\nplain');
    expect(blocks.map((b) => b.type)).toEqual(['heading_1', 'bulleted_list_item', 'to_do', 'paragraph']);
    expect(toADF('a\n\nb').content).toHaveLength(2);
  });
});
