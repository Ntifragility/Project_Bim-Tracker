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

/**
 * Builds the clean Cable Tray Excel (.xlsx) workbook bytes:
 *   Sheet 1 ("Bandejas"):
 *     PLANO | UNIQUE TAG | TENSION | ESC/ACC | SYSTEM TAG | ANCHO | SUB_TIPO | TIPO DE MATERIAL | DESCRIPCION DE MATERIAL | METRADO
 *   Sheet 2 ("Detalle"):
 *     Optional BIM audit metadata
 */
export function buildTrayScheduleWorkbook(rows = [], detailRows = []) {
  const workbook = XLSX.utils.book_new();
  const mainRows = rows.length
    ? rows.map((r) => ({
        "PLANO": r.plano ?? r["PLANO"] ?? "",
        "UNIQUE TAG": r.uniqueTag ?? r.tagUnico ?? r["UNIQUE TAG"] ?? r["TAG UNICO"] ?? "",
        "TENSION": r.tension ?? r["TENSION"] ?? "",
        "ESC/ACC": r.escAcc ?? r["ESC/ACC"] ?? "",
        "SYSTEM TAG": r.systemTag ?? r["SYSTEM TAG"] ?? "",
        "ANCHO": r.ancho ?? r["ANCHO"] ?? "",
        "SUB_TIPO": r.subTipo ?? r["SUB_TIPO"] ?? "",
        "TIPO DE MATERIAL": r.tipoMaterial ?? r["TIPO DE MATERIAL"] ?? "",
        "DESCRIPCION DE MATERIAL": r.descripcionMaterial ?? r["DESCRIPCION DE MATERIAL"] ?? "",
        "METRADO": r.metrado ?? r.longitud ?? r["METRADO"] ?? r["LONGITUD"] ?? "",
      }))
    : [{
        "PLANO": "",
        "UNIQUE TAG": "",
        "TENSION": "",
        "ESC/ACC": "",
        "SYSTEM TAG": "",
        "ANCHO": "",
        "SUB_TIPO": "",
        "TIPO DE MATERIAL": "",
        "DESCRIPCION DE MATERIAL": "",
        "METRADO": "",
      }];

  const wsMain = XLSX.utils.json_to_sheet(mainRows);
  wsMain["!cols"] = [
    { wch: 18 },
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 22 },
    { wch: 36 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(workbook, wsMain, "Bandejas");

  if (Array.isArray(detailRows) && detailRows.length > 0) {
    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail["!cols"] = [
      { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 26 }, { wch: 28 }, { wch: 24 }, { wch: 12 }, { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(workbook, wsDetail, "Detalle");
  }
  return workbook;
}

export function exportTrayScheduleExcelBytes(rows = [], detailRows = []) {
  const wb = buildTrayScheduleWorkbook(rows, detailRows);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

export function exportTrayScheduleExcel(rows = [], detailRows = [], fileName = "Bandejas_Tags.xlsx") {
  const wb = buildTrayScheduleWorkbook(rows, detailRows);
  XLSX.writeFile(wb, fileName);
}
