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
