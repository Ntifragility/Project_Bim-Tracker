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
 * Rounds a positive number UP to 1 decimal place (matching Excel REDONDEAR.MAS(DATA; 1) / ROUNDUP(DATA, 1)).
 * Returns "" if empty or non-numeric.
 */
function roundUpTo1Decimal(value) {
  if (value === null || value === undefined || value === "") return "";
  const cleaned = typeof value === "string" ? value.replace(/[^\d.-]/g, "") : value;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return "";
  if (num === 0) return 0;
  const sign = num < 0 ? -1 : 1;
  const rounded = Math.ceil(Math.abs(num) * 10 - 1e-9) / 10;
  return Number((sign * rounded).toFixed(1));
}

function toNumericOrOriginal(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const str = String(value).trim();
  const num = Number(str);
  return str !== "" && Number.isFinite(num) ? num : value;
}

/**
 * Builds the clean Cable Tray Excel (.xlsx) workbook bytes:
 *   Sheet 1 ("Bandejas"):
 *     PLANO | REV | UNIQUE TAG | TENSION | ESC/ACC | SYSTEM TAG | ANCHO | SUB_TIPO | TIPO DE MATERIAL | DESCRIPCION DE MATERIAL | METRADO
 *     - Formatted as a structured Excel table with AutoFilter on the header row, frozen header, and numeric 0.0 formatting on METRADO (ROUNDUP to 1 decimal).
 *   Sheet 2 ("Detalle"):
 *     Optional BIM audit metadata
 */
export function buildTrayScheduleWorkbook(rows = [], detailRows = []) {
  const workbook = XLSX.utils.book_new();
  const mainRows = rows.length
    ? rows.map((r) => {
        const rawMetrado = r.metrado ?? r.longitud ?? r["METRADO"] ?? r["LONGITUD"] ?? "";
        const roundedMetrado = roundUpTo1Decimal(rawMetrado);
        return {
          "PLANO": r.plano ?? r["PLANO"] ?? "",
          "REV": r.rev ?? r["REV"] ?? "",
          "UNIQUE TAG": r.uniqueTag ?? r.tagUnico ?? r["UNIQUE TAG"] ?? r["TAG UNICO"] ?? "",
          "TENSION": r.tension ?? r["TENSION"] ?? "",
          "ESC/ACC": r.escAcc ?? r["ESC/ACC"] ?? "",
          "SYSTEM TAG": r.systemTag ?? r["SYSTEM TAG"] ?? "",
          "ANCHO": toNumericOrOriginal(r.ancho ?? r["ANCHO"] ?? ""),
          "SUB_TIPO": r.subTipo ?? r["SUB_TIPO"] ?? "",
          "TIPO DE MATERIAL": r.tipoMaterial ?? r["TIPO DE MATERIAL"] ?? "",
          "DESCRIPCION DE MATERIAL": r.descripcionMaterial ?? r["DESCRIPCION DE MATERIAL"] ?? "",
          "METRADO": roundedMetrado,
        };
      })
    : [{
        "PLANO": "",
        "REV": "",
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
    { wch: 8 },
    { wch: 22 },
    { wch: 12 },
    { wch: 13 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 18 },
    { wch: 36 },
    { wch: 14 },
  ];

  // Table formatting: AutoFilter dropdowns on header row + numeric 0.0 format on METRADO (Column K)
  const lastRow = mainRows.length + 1;
  wsMain["!autofilter"] = { ref: `A1:K${lastRow}` };
  wsMain["!rows"] = [{ hpt: 22 }];

  for (let rowIdx = 2; rowIdx <= lastRow; rowIdx++) {
    const metradoCell = wsMain[`K${rowIdx}`];
    if (metradoCell && typeof metradoCell.v === "number") {
      metradoCell.t = "n";
      metradoCell.z = "0.0";
      metradoCell.f = `ROUNDUP(${metradoCell.v},1)`;
    }
  }

  XLSX.utils.book_append_sheet(workbook, wsMain, "Bandejas");

  if (Array.isArray(detailRows) && detailRows.length > 0) {
    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    const detailKeys = Object.keys(detailRows[0] || {});
    if (detailKeys.length > 0) {
      const lastCol = XLSX.utils.encode_col(detailKeys.length - 1);
      wsDetail["!autofilter"] = { ref: `A1:${lastCol}${detailRows.length + 1}` };
    }
    wsDetail["!cols"] = [
      { wch: 18 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 13 }, { wch: 18 },
      { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 36 }, { wch: 14 }, { wch: 24 },
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
