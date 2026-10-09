import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatasetFormat, formatFromFileName } from './parsers';

export const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(json|xlsx)$/;

export interface DatasetFileInfo {
  name: string;
  format: DatasetFormat;
  sizeBytes: number;
  modifiedAt: Date;
}

@Injectable()
export class DatasetStorage implements OnModuleInit {
  readonly exportsDir: string;
  readonly uploadsDir: string;

  constructor(config: ConfigService) {
    const root = resolve(config.getOrThrow<string>('DATA_DIR'));
    this.exportsDir = join(root, 'exports');
    this.uploadsDir = join(root, 'uploads');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.exportsDir, { recursive: true });
    await mkdir(this.uploadsDir, { recursive: true });
  }

  async resolveExport(name: string): Promise<{ path: string; format: DatasetFormat; sizeBytes: number }> {
    const format = formatFromFileName(name);
    if (!SAFE_FILE_NAME.test(name) || !format) {
      throw new BadRequestException('fileName must be a plain .json or .xlsx file name');
    }
    const path = join(this.exportsDir, name);
    try {
      const s = await stat(path);
      if (!s.isFile()) throw new Error('not a file');
      return { path, format, sizeBytes: s.size };
    } catch {
      throw new NotFoundException(`Dataset file "${name}" not found`);
    }
  }

  async listExports(): Promise<DatasetFileInfo[]> {
    const names = await readdir(this.exportsDir);
    const files: DatasetFileInfo[] = [];
    for (const name of names) {
      const format = formatFromFileName(name);
      if (!format || !SAFE_FILE_NAME.test(name)) continue;
      const s = await stat(join(this.exportsDir, name));
      files.push({ name, format, sizeBytes: s.size, modifiedAt: s.mtime });
    }
    return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  }
}
