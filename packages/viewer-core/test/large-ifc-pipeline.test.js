import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  scanIfcChunks,
  extractProjectTagsFromIfc,
  extractTraySystemAssignmentsFromIfc,
} from "../../../src/ifc/ifc-tag-exporter.js";
import { convertIfcFileToFrag } from "../../../scripts/convert-ifc-to-frag.mjs";

const SAMPLE_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('test.ifc','2026-11-18T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0000000000000000000001',$,'TestProj',$,$,$,$,(#2),#3);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
#3=IFCUNITASSIGNMENT((#5));
#4=IFCAXIS2PLACEMENT3D(#6,$,$);
#5=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#6=IFCCARTESIANPOINT((0.,0.,0.));
#10=IFCCABLECARRIERSEGMENT('0000000000000000000010',$,'Tray-01',$,$,$,$,$,$);
#20=IFCPROPERTYSINGLEVALUE('Tag',$,IFCLABEL('CT-101'),$);
#21=IFCPROPERTYSET('0000000000000000000021',$,'CCP_TAG',$,(#20));
#22=IFCRELDEFINESBYPROPERTIES('0000000000000000000022',$,$,$,(#10),#21);
#30=IFCPROPERTYSINGLEVALUE('SystemTag',$,IFCLABEL('PWR-A'),$);
#31=IFCPROPERTYSINGLEVALUE('ElementTag',$,IFCLABEL('PWR-A-001'),$);
#32=IFCPROPERTYSET('0000000000000000000032',$,'CCP_TRAY_SYSTEM',$,(#30,#31));
#33=IFCRELDEFINESBYPROPERTIES('0000000000000000000033',$,$,$,(#10),#32);
ENDSEC;
END-ISO-10303-21;
`;

describe("Large IFC -> .frag Streaming Pipeline", () => {
  it("scanIfcChunks splits Uint8Array across tiny 128-byte boundaries without losing lines", () => {
    const bytes = new TextEncoder().encode(SAMPLE_IFC);
    const chunks = [];
    scanIfcChunks(bytes, (text) => chunks.push(text), 128);
    assert.ok(chunks.length > 3, `expected multiple chunks, got ${chunks.length}`);
    assert.equal(chunks.join(""), SAMPLE_IFC);
  });

  it("extractProjectTagsFromIfc resolves tags cleanly across small chunk boundaries", () => {
    const bytes = new TextEncoder().encode(SAMPLE_IFC);
    const tags = extractProjectTagsFromIfc(bytes, { chunkSize: 120 });
    assert.equal(tags.get(10)?.tag, "CT-101");

    const traySys = extractTraySystemAssignmentsFromIfc(bytes);
    assert.equal(traySys.get(10)?.systemTag, "PWR-A");
    assert.equal(traySys.get(10)?.elementTag, "PWR-A-001");
  });

  it("convertIfcFileToFrag streams IFC from disk via OpenModelFromCallback and outputs .frag", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-frag-test-"));
    const inIfc = path.join(tmpDir, "tiny.ifc");
    const outFrag = path.join(tmpDir, "tiny.frag");
    fs.writeFileSync(inIfc, SAMPLE_IFC, "utf8");

    try {
      const res = await convertIfcFileToFrag(inIfc, outFrag, { lean: true });
      assert.equal(fs.existsSync(outFrag), true);
      assert.ok(res.outputBytes > 0, "expected non-empty .frag output");
      assert.equal(res.leanMode, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
