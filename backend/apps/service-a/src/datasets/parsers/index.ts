import { parseJsonArrayFile } from './json-array.parser';
import { DatasetFormat, SourceRecord } from './record-source';
import { parseXlsxFile } from './xlsx.parser';

export * from './record-source';

export function parseDatasetFile(path: string, format: DatasetFormat): AsyncGenerator<SourceRecord> {
  return format === 'json' ? parseJsonArrayFile(path) : parseXlsxFile(path);
}
