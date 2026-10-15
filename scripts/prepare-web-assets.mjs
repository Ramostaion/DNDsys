import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export async function prepareWebAssets(directory = join(root, 'apps/web/dist/assets')) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await prepareWebAssets(path);
      continue;
    }
    if (!/\.(?:js|css|svg|json)$/i.test(entry.name)) continue;
    const bytes = await readFile(path);
    await Promise.all([
      promisify(brotliCompress)(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).then((data) =>
        writeFile(path + '.br', data),
      ),
      promisify(gzip)(bytes, { level: 6 }).then((data) => writeFile(path + '.gz', data)),
    ]);
    count++;
  }
  return count;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Prepared Brotli/gzip assets: ${await prepareWebAssets()}`);
}
