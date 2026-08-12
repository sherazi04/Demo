/**
 * Minimal RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled in as a dependency because the requirement is
 * narrow (a few hundred rows of admin-supplied roster data) and the failure
 * modes that matter — quoted fields containing commas, embedded newlines,
 * escaped quotes, and a UTF-8 BOM from Excel — are all handled here explicitly.
 */

export function parseCsv(input: string): string[][] {
  // Excel prefixes UTF-8 exports with a BOM, which otherwise becomes part of
  // the first header name and breaks the column lookup.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty final row; drop it.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Normalise CRLF and lone CR alike.
      if (text[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

export interface CsvTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** Parses with the first row as headers, lower-cased and trimmed. */
export function parseCsvTable(input: string): CsvTable {
  const raw = parseCsv(input);
  const [headerRow, ...bodyRows] = raw;
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map((h) => h.trim().toLowerCase());
  const rows = bodyRows.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { headers, rows };
}
