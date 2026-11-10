import * as XLSX from "xlsx";

/**
 * Reads an Excel workbook from an ArrayBuffer or Uint8Array.
 * Returns sheet names and a helper to read sheet rows as plain JSON objects.
 */
export function readWorkbook(data) {
  const workbook = XLSX.read(data, { type: "array" });
  return {
    sheetNames: workbook.SheetNames || [],
    readSheet(sheetName, { defval = "" } = {}) {
      const name = sheetName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[name];
      if (!worksheet) return [];
      return XLSX.utils.sheet_to_json(worksheet, { defval });
    },
    raw: workbook,
  };
}

/**
 * Exports tag register rows and summary rows into an Excel file.
 */
export function exportTagMapping(tagRegisterRows, summaryRows = [], fileName = "IFC_Tag_Mapping.xlsx") {
  const worksheet = XLSX.utils.json_to_sheet(tagRegisterRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tag Register");

  if (summaryRows && summaryRows.length > 0) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summaryRows),
      "Summary"
    );
  }

  XLSX.writeFile(workbook, fileName);
}

/**
 * Writes workbook data to binary Uint8Array / ArrayBuffer (headless / test friendly).
 */
export function writeWorkbookBytes(sheetsMap) {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheetsMap)) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}
