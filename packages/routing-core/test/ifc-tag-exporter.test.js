import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addProjectTagsToIfc,
  addTraySystemAssignmentsToIfc,
  createIfcGuid,
  extractProjectTagsFromIfc,
  extractTraySystemAssignmentsFromIfc,
  taggedIfcFileName,
} from '../../../src/ifc/ifc-tag-exporter.js';
import { applySafeIfcEdits, editedIfcFileName } from '../../../src/ifc/ifc-safe-editor.js';

const fixture = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaaa',$,'Project',$,$,$,$,$,$);
#10=IFCBUILDINGELEMENTPART('1aaaaaaaaaaaaaaaaaaaaa',$,'Tray',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
`;

test('creates valid-length IFC compressed GUIDs', () => {
  const guid = createIfcGuid();
  assert.match(guid, /^[0-3][0-9A-Za-z_$]{21}$/);
});

test('appends CCP_TAG and relates it to the assigned IFC entity', () => {
  const result = addProjectTagsToIfc(fixture, [{ localId: 10, tag: "CT-'01" }]);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.match(result.text, /IFCPROPERTYSINGLEVALUE\('Tag',\$,IFCLABEL\('CT-''01'\),\$\)/);
  assert.match(result.text, /IFCPROPERTYSET\('[0-3][0-9A-Za-z_$]{21}',\$,'CCP_TAG'/);
  assert.match(result.text, /IFCRELDEFINESBYPROPERTIES\('[0-3][0-9A-Za-z_$]{21}',\$,\$,\$,\(#10\),#/);
  assert.ok(result.text.indexOf('CCP_TAG') < result.text.lastIndexOf('ENDSEC;'));
});

test('detects and updates an existing CCP_TAG without creating a duplicate property set', () => {
  const firstExport = addProjectTagsToIfc(fixture, [{ localId: 10, tag: 'CT-001' }]);
  const existing = extractProjectTagsFromIfc(firstExport.bytes);
  assert.equal(existing.get(10)?.tag, 'CT-001');

  const secondExport = addProjectTagsToIfc(firstExport.bytes, [{ localId: 10, tag: 'CT-002' }]);
  assert.equal(secondExport.applied[0].action, 'updated');
  assert.equal(extractProjectTagsFromIfc(secondExport.bytes).get(10)?.tag, 'CT-002');
  assert.equal((secondExport.text.match(/'CCP_TAG'/g) || []).length, 1);
});

test('supports a mix of tagged and untagged elements', () => {
  const twoElementFixture = fixture.replace(
    'ENDSEC;\nEND-ISO',
    "#11=IFCBUILDINGELEMENTPART('2aaaaaaaaaaaaaaaaaaaaa',$,'Tray 2',$,$,$,$,$,$);\nENDSEC;\nEND-ISO",
  );
  const firstExport = addProjectTagsToIfc(twoElementFixture, [{ localId: 10, tag: 'CT-001' }]);
  const secondExport = addProjectTagsToIfc(firstExport.bytes, [
    { localId: 10, tag: 'CT-010' },
    { localId: 11, tag: 'CT-011' },
  ]);
  const tags = extractProjectTagsFromIfc(secondExport.bytes);
  assert.equal(tags.get(10)?.tag, 'CT-010');
  assert.equal(tags.get(11)?.tag, 'CT-011');
});

test('skips assignments whose element is absent from the source IFC', () => {
  assert.throws(
    () => addProjectTagsToIfc(fixture, [{ localId: 999, tag: 'CT-999' }]),
    /No tag assignments matched/,
  );
});

test('creates a non-destructive tagged IFC filename', () => {
  assert.equal(taggedIfcFileName('CableTray.ifc'), 'CableTray_tagged.ifc');
});

test('writes and re-reads tray system and sequential component properties', () => {
  const result = addTraySystemAssignmentsToIfc(fixture, [{
    localId: 10,
    systemTag: '140ST-900-001',
    componentId: '140ST-900-001-C001',
    sequenceNumber: '001',
  }]);
  const assignment = extractTraySystemAssignmentsFromIfc(result.bytes).get(10);
  assert.equal(assignment.systemTag, '140ST-900-001');
  assert.equal(assignment.componentId, '140ST-900-001-C001');
  assert.equal(assignment.sequenceNumber, '001');
  assert.match(result.text, /'CCP_TRAY_SYSTEM'/);
  assert.doesNotMatch(result.text, /'CCP_COMPONENT'/);
});

test('updates tray assignment properties without duplicating property sets', () => {
  const first = addTraySystemAssignmentsToIfc(fixture, [{
    localId: 10,
    systemTag: 'SYS-A',
    componentId: 'SYS-A-C001',
    sequenceNumber: '001',
  }]);
  const second = addTraySystemAssignmentsToIfc(first.bytes, [{
    localId: 10,
    systemTag: 'SYS-B',
    componentId: 'SYS-B-C004',
    sequenceNumber: '004',
  }]);
  const assignment = extractTraySystemAssignmentsFromIfc(second.bytes).get(10);
  assert.equal(assignment.systemTag, 'SYS-B');
  assert.equal(assignment.componentId, 'SYS-B-C004');
  assert.equal((second.text.match(/'CCP_TRAY_SYSTEM'/g) || []).length, 1);
});

test('deletes a saved tray assignment by clearing its property values', () => {
  const first = addTraySystemAssignmentsToIfc(fixture, [{
    localId: 10,
    systemTag: 'SYS-A',
    componentId: 'SYS-A-C001',
    sequenceNumber: '001',
  }]);
  const removed = addTraySystemAssignmentsToIfc(first.bytes, [{ localId: 10, delete: true }]);
  assert.equal(removed.applied[0].action, 'deleted');
  assert.equal(extractTraySystemAssignmentsFromIfc(removed.bytes).has(10), false);
  assert.match(removed.text, /IFCPROPERTYSINGLEVALUE\('SystemTag',\$,IFCLABEL\(''\),\$\)/);
  assert.equal((removed.text.match(/'CCP_TRAY_SYSTEM'/g) || []).length, 1);
});

const editableFixture = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaaa',$,'Project',$,$,$,$,$,$);
#10=IFCBUILDINGELEMENTPART('1aaaaaaaaaaaaaaaaaaaaa',$,'Tray',$,$,$,#20,$);
#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));
#21=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#22));
#22=IFCEXTRUDEDAREASOLID(#23,#24,#25,1.);
#40=IFCPROPERTYSINGLEVALUE('Status',$,IFCLABEL('Old'),$);
#41=IFCPROPERTYSET('2aaaaaaaaaaaaaaaaaaaaa',$,'Pset_Test',$,(#40));
#42=IFCRELDEFINESBYPROPERTIES('3aaaaaaaaaaaaaaaaaaaaa',$,$,$,(#10),#41);
ENDSEC;
END-ISO-10303-21;
`;

test('safely updates an existing single-value property and adds persistent IFC color styling', () => {
  const result = applySafeIfcEdits(editableFixture, {
    propertyEdits: [{ localId: 10, propertySet: 'Pset_Test', property: 'Status', value: "Ready's" }],
    colorEdits: [{ localId: 10, color: '#ff0000', transparency: 0.25 }],
  });
  assert.match(result.text, /IFCPROPERTYSINGLEVALUE\('Status',\$,IFCLABEL\('Ready''s'\),\$\)/);
  assert.match(result.text, /IFCCOLOURRGB\(\$,1\.000000,0\.000000,0\.000000\)/);
  assert.match(result.text, /IFCSURFACESTYLESHADING\(#[0-9]+,0\.250000\)/);
  assert.match(result.text, /IFCSTYLEDITEM\(#22,\(#[0-9]+\),\$\)/);
  assert.equal(result.applied.length, 2);
});

test('updates the visible source style of an IFC mapped representation', () => {
  const mappedStyledFixture = editableFixture
    .replace("#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));", "#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#31));")
    .replace("#21=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#22));", [
      "#21=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#22));",
      "#25=IFCAXIS2PLACEMENT3D(#26,$,$);",
      "#26=IFCCARTESIANPOINT((0.,0.,0.));",
      "#27=IFCREPRESENTATIONMAP(#25,#21);",
      "#28=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#26,1.,$);",
      "#29=IFCMAPPEDITEM(#27,#28);",
      "#31=IFCSHAPEREPRESENTATION(#30,'Body','MappedRepresentation',(#29));",
      "#32=IFCSTYLEDITEM(#22,(#33),$);",
      "#33=IFCPRESENTATIONSTYLEASSIGNMENT((#34));",
      "#34=IFCSURFACESTYLE('Original',.BOTH.,(#35));",
      "#35=IFCSURFACESTYLERENDERING(#36,0.,#36,$,$,$,$,$,$);",
      "#36=IFCCOLOURRGB($,0.1,0.2,0.3);",
    ].join('\n'));
  const result = applySafeIfcEdits(mappedStyledFixture, {
    colorEdits: [{ localId: 10, color: '#00ff00', transparency: 0.4 }],
  });
  assert.match(result.text, /#36=IFCCOLOURRGB\(\$,0\.000000,1\.000000,0\.000000\);/);
  assert.match(result.text, /#35=IFCSURFACESTYLERENDERING\(#36,0\.400000,#36,/);
  assert.equal((result.text.match(/IFCSTYLEDITEM/g) || []).length, 1);
  assert.equal(result.applied[0].action, 'updated');
});

test('creates missing properties only inside BIM_TRACKER_EDIT', () => {
  const result = applySafeIfcEdits(editableFixture, {
    propertyEdits: [
      { localId: 10, propertySet: 'BIM_TRACKER_EDIT', property: 'ReviewStatus', value: 'Approved' },
      { localId: 10, propertySet: 'BIM_TRACKER_EDIT', property: 'Discipline', value: 'Electrical' },
    ],
  });
  assert.match(result.text, /'BIM_TRACKER_EDIT'/);
  assert.match(result.text, /IFCPROPERTYSINGLEVALUE\('ReviewStatus',\$,IFCLABEL\('Approved'\),\$\)/);
  assert.match(result.text, /IFCPROPERTYSINGLEVALUE\('Discipline',\$,IFCLABEL\('Electrical'\),\$\)/);
  assert.equal((result.text.match(/'BIM_TRACKER_EDIT'/g) || []).length, 1);
  assert.throws(
    () => applySafeIfcEdits(editableFixture, {
      propertyEdits: [{ localId: 10, propertySet: 'Pset_Missing', property: 'Unsafe', value: 'No' }],
    }),
    /No safe IFC edits/,
  );
});

test('creates typed manual metadata in a COSAPI custom property set', () => {
  const result = applySafeIfcEdits(editableFixture, {
    propertyEdits: [
      { localId: 10, propertySet: 'COSAPI_CONSTRUCTION', property: 'WBS', value: '03.02.015', valueType: 'IFCIDENTIFIER' },
      { localId: 10, propertySet: 'COSAPI_CONSTRUCTION', property: 'Progress', value: '35.5', valueType: 'IFCREAL' },
      { localId: 10, propertySet: 'COSAPI_CONSTRUCTION', property: 'PlannedDate', value: '2026-08-15', valueType: 'IFCDATE' },
    ],
  });
  assert.match(result.text, /IFCIDENTIFIER\('03\.02\.015'\)/);
  assert.match(result.text, /IFCREAL\(35\.5\)/);
  assert.match(result.text, /IFCDATE\('2026-08-15'\)/);
  assert.equal((result.text.match(/'COSAPI_CONSTRUCTION'/g) || []).length, 1);
});

test('creates a non-destructive edited IFC filename', () => {
  assert.equal(editedIfcFileName('CableTray.ifc'), 'CableTray_edited.ifc');
});
