import { protectedHandle } from './coordinatorAuth.ts';
import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import type { Knex } from 'knex';
import { z } from 'zod';
import { logoDataUrl, validateDataUrl, MAX_LOGO_BYTES } from './brandingRules.ts';

type BrandingRow = {
  id: number;
  college_name: string;
  department_name: string;
  copyright_text: string;
  developer_name: string;
  college_logo_data: string | null;
  developer_logo_data: string | null;
  updated_at: string;
};

const inputSchema = z.object({
  collegeName: z.string().trim().min(2, 'Enter the official college name.').max(200),
  departmentName: z.string().trim().min(2, 'Enter the department name.').max(160),
  copyrightText: z.string().trim().max(300),
  developerName: z.string().trim().max(160),
  collegeLogo: z.unknown(),
  developerLogo: z.unknown(),
});

function checkedImageData(value: unknown): string | null {
  const dataUrl = validateDataUrl(value);
  if (dataUrl === null) return null;
  const imageBytes = Buffer.from(dataUrl.substring(dataUrl.indexOf(',') + 1), 'base64');
  const img = nativeImage.createFromBuffer(imageBytes);
  const size = img.getSize();
  if (img.isEmpty() || size.width < 1 || size.height < 1 ||
      size.width > 4096 || size.height > 4096) {
    throw new Error('Logo could not be decoded, or its dimensions exceed 4096 pixels.');
  }
  return dataUrl;
}

function toClient(row?: BrandingRow) {
  return {
    collegeName: row?.college_name ?? '',
    departmentName: row?.department_name ?? 'Department of Computer Applications',
    copyrightText: row?.copyright_text ?? '',
    developerName: row?.developer_name ?? '',
    collegeLogo: row?.college_logo_data ?? null,
    developerLogo: row?.developer_logo_data ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function ensureCollegeBrandingSchema(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('institution_branding'))) {
    await db.schema.createTable('institution_branding', t => {
      t.integer('id').primary();
      t.string('college_name', 200).notNullable();
      t.string('department_name', 160).notNullable();
      t.string('copyright_text', 300).notNullable().defaultTo('');
      t.string('developer_name', 160).notNullable().defaultTo('');
      t.text('college_logo_data').nullable();
      t.text('developer_logo_data').nullable();
      t.string('updated_at', 36).notNullable();
    });
  }
}

export function registerCollegeBrandingHandlers(db: Knex): void {
  protectedHandle('branding:get', async () => {
    const row = await db<BrandingRow>('institution_branding').where({ id: 1 }).first();
    return toClient(row);
  });

  protectedHandle('branding:chooseLogo', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choose PNG or JPG logo (maximum 2 MB)',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'PNG or JPG images', extensions: ['png', 'jpg', 'jpeg'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const filename = result.filePaths[0];
    const fileStat = await stat(filename);
    if (!fileStat.isFile() || fileStat.size > MAX_LOGO_BYTES) throw new Error('Select a PNG/JPG logo smaller than 2 MB.');
    const bytes = await readFile(filename);
    return checkedImageData(logoDataUrl(bytes));
  });

  protectedHandle('branding:save', async (_event, raw: unknown) => {
    const input = inputSchema.parse(raw);
    const values: Omit<BrandingRow, 'id'> = {
      college_name: input.collegeName,
      department_name: input.departmentName,
      copyright_text: input.copyrightText,
      developer_name: input.developerName,
      college_logo_data: checkedImageData(input.collegeLogo),
      developer_logo_data: checkedImageData(input.developerLogo),
      updated_at: new Date().toISOString(),
    };
    await db.transaction(async trx => {
      const current = await trx('institution_branding').where({ id: 1 }).first();
      if (current) await trx('institution_branding').where({ id: 1 }).update(values);
      else await trx('institution_branding').insert({ id: 1, ...values });
    });
    return toClient({ id: 1, ...values });
  });
}
