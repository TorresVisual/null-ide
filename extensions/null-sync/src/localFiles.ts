'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { CORE_FILES, categoryOf, isSyncableFile } from './layout';
import { Category } from './types';

const KEEP_BACKUPS = 10;

export interface LocalFilesOptions {
  /** `<User>`: the folder that holds settings.json, keybindings.json and snippets/. */
  userDir: string;
  /** Where the losing version of a pull or conflict is kept (`<name>.<ms timestamp>`). */
  backupsDir: string;
  /** True while the file at this absolute path is open in an editor with unsaved edits. */
  isDirty(absolutePath: string): boolean;
  now(): number;
}

/** The synced files on disk. Every name goes through `isSyncableFile`, so a hostile remote name can never reach the file system. */
export class LocalFiles {
  constructor(private readonly options: LocalFilesOptions) {}

  private pathOf(file: string): string {
    if (!isSyncableFile(file)) throw new Error(`Refusing to touch '${file}'.`);
    return path.join(this.options.userDir, ...file.split('/'));
  }

  isDirty(file: string): boolean {
    return this.options.isDirty(this.pathOf(file));
  }

  /** `null` if the file does not exist. */
  async read(file: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(this.pathOf(file), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Raw contents of every existing synced file in the given categories. */
  async list(categories: Category[]): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    const add = async (file: string): Promise<void> => {
      try {
        const text = await this.read(file);
        if (text !== null) found[file] = text;
      } catch {
        /* unreadable (for example a folder named x.json): not a synced file */
      }
    };
    for (const file of CORE_FILES) {
      if (categories.includes(categoryOf(file))) await add(file);
    }
    if (categories.includes('snippets')) {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(path.join(this.options.userDir, 'snippets'));
      } catch {
        /* no snippets folder */
      }
      for (const name of names) {
        if (isSyncableFile(`snippets/${name}`)) await add(`snippets/${name}`);
      }
    }
    return found;
  }

  /** Writes atomically (temp file + rename) after backing up what is there; `null` deletes the file. */
  async write(file: string, content: string | null): Promise<void> {
    const target = this.pathOf(file);
    await this.backup(file, target);
    if (content === null) {
      await fs.promises.rm(target, { force: true });
      return;
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.null-sync.tmp`;
    await fs.promises.writeFile(temp, content, 'utf8');
    await fs.promises.rename(temp, target);
  }

  private async backup(file: string, target: string): Promise<void> {
    if (!fs.existsSync(target)) return;
    const { backupsDir, now } = this.options;
    await fs.promises.mkdir(backupsDir, { recursive: true });
    const stem = file.replace('/', '__');
    await fs.promises.copyFile(target, path.join(backupsDir, `${stem}.${now()}`));
    const stamp = (name: string): number | undefined => {
      const rest = name.startsWith(`${stem}.`) ? name.slice(stem.length + 1) : '';
      return /^\d+$/.test(rest) ? Number(rest) : undefined;
    };
    const mine = (await fs.promises.readdir(backupsDir))
      .filter((name) => stamp(name) !== undefined)
      .sort((a, b) => stamp(b)! - stamp(a)!);
    for (const old of mine.slice(KEEP_BACKUPS)) await fs.promises.rm(path.join(backupsDir, old), { force: true });
  }
}
