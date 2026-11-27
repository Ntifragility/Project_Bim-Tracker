import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportTrayScheduleExcelBytes, readWorkbook } from "../src/index.js";
import {
  formatSequentialTag,
  allocateSequentialTags,
  compareNaturalTags,
} from "../../../src/tagging/sequential-tagger.js";

describe("Cable Tray Sequential Tagger & Excel Schedule (TAG UNICO / ANCHO / LONGITUD)", () => {
  it("allocates Fixed + Variable sequential tags, skips collisions, and sorts naturally", () => {
    assert.equal(formatSequentialTag("CT01.01.", 1, 2), "CT01.01.01");
    assert.equal(formatSequentialTag("BC-101-", 12, 3), "BC-101-012");

    const elements = [{ localId: 10 }, { localId: 20 }, { localId: 30 }];
    const res = allocateSequentialTags({
      elements,
      prefix: "CT01.01.",
      startSequence: 1,
      digits: 2,
      existingTags: ["CT01.01.02"],
    });
    assert.equal(res.valid, true);
    assert.deepEqual(
      res.assignments.map((a) => a.elementTag),
      ["CT01.01.01", "CT01.01.03", "CT01.01.04"],
    );
    assert.equal(res.nextSequence, 5);

    const sorted = ["CT01.01.10", "CT01.01.02", "CT01.01.01"].sort(compareNaturalTags);
    assert.deepEqual(sorted, ["CT01.01.01", "CT01.01.02", "CT01.01.10"]);
  });

  it("exports Excel workbook with exact TAG UNICO, ANCHO, LONGITUD columns on Bandejas sheet", () => {
    const bytes = exportTrayScheduleExcelBytes(
      [
        { tagUnico: "CT01.01.01", ancho: 300, longitud: 3.0 },
        { tagUnico: "CT01.01.02", ancho: 300, longitud: 1.45 },
      ],
      [
        { "TAG UNICO": "CT01.01.01", IFC_Type: "IFCCABLECARRIERSEGMENT", Local_ID: 10 },
        { "TAG UNICO": "CT01.01.02", IFC_Type: "IFCCABLECARRIERFITTING", Local_ID: 20 },
      ],
    );

    assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 500);
    const wb = readWorkbook(bytes);
    assert.deepEqual(wb.sheetNames, ["Bandejas", "Detalle"]);

    const rows = wb.readSheet("Bandejas");
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), ["TAG UNICO", "ANCHO", "LONGITUD"]);
    assert.equal(rows[0]["TAG UNICO"], "CT01.01.01");
    assert.equal(rows[0]["ANCHO"], 300);
    assert.equal(rows[0]["LONGITUD"], 3);
    assert.equal(rows[1]["LONGITUD"], 1.45);
  });
});
