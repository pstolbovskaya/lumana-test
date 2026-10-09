import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { DatasetParseError, SourceRecord } from './record-source';

async function detectRoot(path: string): Promise<'[' | '{'> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart();
    const first = text[0];
    if (first === '[' || first === '{') return first;
    throw new DatasetParseError('JSON root must be an array or an object with a "data" array');
  } finally {
    await fh.close();
  }
}

export async function* parseJsonArrayFile(path: string): AsyncGenerator<SourceRecord> {
  const root = await detectRoot(path);
  const pipeline = chain([
    createReadStream(path),
    parser(),
    ...(root === '{' ? [pick({ filter: 'data' })] : []),
    streamArray(),
  ]);
  try {
    for await (const item of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
      yield { row: item.key + 1, record: item.value };
    }
  } catch (err) {
    throw new DatasetParseError(`Malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    pipeline.destroy();
  }
}
