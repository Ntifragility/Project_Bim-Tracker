import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addProjectTagsToIfc,
  createIfcGuid,
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

test('appends Pset_ProjectTag and relates it to the assigned IFC entity', () => {
  const result = addProjectTagsToIfc(fixture, [{ localId: 10, tag: "CT-'01" }]);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.match(result.text, /IFCPROPERTYSINGLEVALUE\('Tag',\$,IFCLABEL\('CT-''01'\),\$\)/);
  assert.match(result.text, /IFCPROPERTYSET\('[0-3][0-9A-Za-z_$]{21}',\$,'Pset_ProjectTag'/);
  assert.match(result.text, /IFCRELDEFINESBYPROPERTIES\('[0-3][0-9A-Za-z_$]{21}',\$,\$,\$,\(#10\),#/);
  assert.ok(result.text.indexOf('Pset_ProjectTag') < result.text.lastIndexOf('ENDSEC;'));
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

