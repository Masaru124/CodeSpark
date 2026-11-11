/**
 * Minimal .xlsx reader — enough to turn the Google Forms registration export
 * into CSV. It reads the ZIP container with the platform's DecompressionStream
 * (Node 20 and Cloudflare Workers both have it), so no dependency is added.
 *
 * Only cell values are extracted: shared strings, inline strings and numbers.
 * Formatting, formulas and styles are ignored.
 */

const decoder = new TextDecoder();

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  // End of central directory record: signature 0x06054b50, scanned backwards
  // because it may be followed by a zip comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const entries = u16(bytes, eocd + 10);
  let cursor = u32(bytes, eocd + 16);
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < entries; i += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) break;
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    // Local header repeats the name/extra lengths; data follows them.
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);

    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflateRaw(data));
  }

  return files;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  return xmlEscape(
    [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""),
  );
}

function columnIndex(reference: string): number {
  const letters = (reference.match(/^[A-Z]+/i)?.[0] ?? "A").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  for (const rowMatch of xml.matchAll(rowPattern)) {
    const cells: string[] = [];
    const cellPattern = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
    for (const cellMatch of rowMatch[1].matchAll(cellPattern)) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? "";
      const body = cellMatch[3] ?? "";
      const reference = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      let value = "";
      if (type === "inlineStr") value = textOf(body);
      else if (type === "s") {
        const index = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        value = Number.isInteger(index) ? (shared[index] ?? "") : "";
      } else {
        value = xmlEscape(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      }
      const column = reference ? columnIndex(reference) : cells.length;
      while (cells.length < column) cells.push("");
      cells[column] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function toCsv(rows: string[][]): string {
  const escapeCell = (value: string) => {
    const clean = value.replace(/\r?\n/g, " ").trim();
    return /[",]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
  };
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}

/** First worksheet of an .xlsx file as CSV text. */
export async function xlsxToCsv(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const sheetName =
    [...files.keys()].find((name) => /^xl\/worksheets\/sheet1\.xml$/i.test(name)) ??
    [...files.keys()].find((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name));
  if (!sheetName) throw new Error("no worksheet found");

  const shared = sharedStrings(files.get("xl/sharedStrings.xml") ? decoder.decode(files.get("xl/sharedStrings.xml")!) : undefined);
  const rows = sheetRows(decoder.decode(files.get(sheetName)!), shared).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  if (rows.length === 0) throw new Error("the first worksheet is empty");
  return toCsv(rows);
}
