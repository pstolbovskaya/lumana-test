import { createWriteStream, WriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';

export const tempPathFor = (finalPath: string): string => `${finalPath}.${randomUUID()}.part`;

export interface DatasetWriter {
  readonly finalPath: string;
  write(record: Record<string, unknown>): Promise<void>;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export class JsonArrayWriter implements DatasetWriter {
  private readonly tmpPath: string;
  private readonly stream: WriteStream;
  private count = 0;

  constructor(readonly finalPath: string) {
    this.tmpPath = tempPathFor(finalPath);
    this.stream = createWriteStream(this.tmpPath, { encoding: 'utf8' });
    this.stream.write('[\n');
  }

  async write(record: Record<string, unknown>): Promise<void> {
    const chunk = (this.count++ === 0 ? '' : ',\n') + JSON.stringify(record);
    if (!this.stream.write(chunk)) await once(this.stream, 'drain');
  }

  async commit(): Promise<void> {
    this.stream.end('\n]\n');
    await once(this.stream, 'finish');
    await rename(this.tmpPath, this.finalPath);
  }

  async abort(): Promise<void> {
    this.stream.destroy();
    await rm(this.tmpPath, { force: true });
  }
}

export class XlsxWriter implements DatasetWriter {
  private readonly tmpPath: string;
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly sheet: ExcelJS.Worksheet;

  constructor(
    readonly finalPath: string,
    private readonly columns: readonly string[],
    sheetName = 'data',
  ) {
    this.tmpPath = tempPathFor(finalPath);
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: this.tmpPath,
      useStyles: false,
      useSharedStrings: false,
    });
    this.sheet = this.workbook.addWorksheet(sheetName);
    this.sheet.columns = columns.map((c) => ({ header: c, key: c, width: 24 }));
  }

  write(record: Record<string, unknown>): Promise<void> {
    const row: Record<string, string | number | boolean | null> = {};
    for (const c of this.columns) {
      const v = record[c];
      row[c] =
        v === undefined || v === null
          ? null
          : typeof v === 'object'
            ? JSON.stringify(v)
            : (v as string | number | boolean);
    }
    this.sheet.addRow(row).commit();
    return Promise.resolve();
  }

  async commit(): Promise<void> {
    (this.sheet as unknown as { commit(): void }).commit();
    await this.workbook.commit();
    await rename(this.tmpPath, this.finalPath);
  }

  async abort(): Promise<void> {
    await this.workbook.commit().catch(() => undefined);
    await rm(this.tmpPath, { force: true });
  }
}
