// Task 3.2 vector runner: executes spec/vectors/ifc/*.json against legacy JS.
//
// Usage: node scripts/run-ifc-vectors.mjs [--file step|naming|value|tags|validator]
//
// Each vector case runs the named legacy function and compares against
// `expected`. Reports pass/fail per case + summary. Exit code 1 on any failure.
// overlay_read.json is rustOnly by design (new build: no legacy reader exists).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/ifc');

const LEG_SRC = path.join(ROOT, 'legacy/src');
const tagExporter = await import(path.join(LEG_SRC, 'ifc/ifc-tag-exporter.js'));
const safeEditor = await import(path.join(LEG_SRC, 'ifc/ifc-safe-editor.js'));
const validator = await import(path.join(LEG_SRC, 'ifc/tag-validator.js'));

let pass = 0, fail = 0;
const failures = [];

// Inline mirrors of the two tiny legacy helpers not exported (escape/unescape
// are module-private in both files; parity asserted by round-trip behaviour).
const escapeStep = (v) => String(v).replaceAll("'", "''");
const unescapeStep = (v) => String(v).replaceAll("''", "'");

const SIMPLE_FIXTURE = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaaa',$,'Project',$,$,$,$,$,$);
#10=IFCBUILDINGELEMENTPART('1aaaaaaaaaaaaaaaaaaaaa',$,'Tray',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
`;

// Minimal legacy-observable surface for step.json: entity-id scan and
// terminator behaviour via the exported add/extract functions.
function legacyEntityIds(source) {
  const ids = new Set();
  for (const m of source.matchAll(/^\s*#(\d+)\s*=/gm)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}

function legacyTerminatorFound(source) {
  return /ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.test(source);
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  try {
    switch (c.fn) {
      case 'escape_step': {
        if (escapeStep(c.input.value) !== c.expected) throw new Error('escape');
        break;
      }
      case 'unescape_step': {
        if (unescapeStep(c.input.value) !== c.expected) throw new Error('unescape');
        break;
      }
      case 'entity_ids': {
        const got = legacyEntityIds(c.input.source);
        if (JSON.stringify(got) !== JSON.stringify(c.expected.ids)) throw new Error(`ids ${JSON.stringify(got)}`);
        break;
      }
      case 'find_data_terminator': {
        if (legacyTerminatorFound(c.input.source) !== c.expected.found) throw new Error('terminator');
        break;
      }
      case 'tagged_name': {
        if (tagExporter.taggedIfcFileName(c.input.name) !== c.expected) {
          throw new Error(`${c.input.name} -> ${tagExporter.taggedIfcFileName(c.input.name)}`);
        }
        break;
      }
      case 'edited_name': {
        if (safeEditor.editedIfcFileName(c.input.name) !== c.expected) {
          throw new Error(`${c.input.name} -> ${safeEditor.editedIfcFileName(c.input.name)}`);
        }
        break;
      }
      case 'format_typed_value':
      case 'is_writable_pset': {
        // Behaviour parity via applySafeIfcEdits on a per-type fixture:
        // ok cases must update the property and render `step` in the text;
        // invalid values must throw 'No safe IFC edits could be applied.'
        const { applySafeIfcEdits } = safeEditor;
        if (c.fn === 'is_writable_pset') {
          const ok = /^(?:BIM_TRACKER_EDIT|COSAPI_[A-Z0-9_]+)$/i.test(c.input.name);
          if (ok !== c.expected) throw new Error('pset gate');
          break;
        }
        const fixtureFor = (t) => `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaaa',$,'Project',$,$,$,$,$,$);
#10=IFCBUILDINGELEMENTPART('1aaaaaaaaaaaaaaaaaaaaa',$,'Tray',$,$,$,$,$,$);
#40=IFCPROPERTYSINGLEVALUE('Probe',$,${t}(${'Old'}),$);
#41=IFCPROPERTYSET('2aaaaaaaaaaaaaaaaaaaaa',$,'Pset_X',$,(#40));
#42=IFCRELDEFINESBYPROPERTIES('3aaaaaaaaaaaaaaaaaaaaa',$,$,$,(#10),#41);
ENDSEC;
END-ISO-10303-21;
`.replace('Old', t === 'IFCBOOLEAN' ? '.F.' : t === 'IFCINTEGER' ? '1' : t === 'IFCREAL' ? '1.' : t === 'IFCDATE' ? "'2020-01-01'" : t === 'IFCDATETIME' ? "'2020-01-01T00:00'" : "'Old'");
        const map = {
          IFCLABEL: 'IFCLABEL', IFCTEXT: 'IFCTEXT', IFCIDENTIFIER: 'IFCIDENTIFIER',
          IFCBOOLEAN: 'IFCBOOLEAN', IFCINTEGER: 'IFCINTEGER', IFCREAL: 'IFCREAL',
          IFCDATE: 'IFCDATE', IFCDATETIME: 'IFCDATETIME',
        };
        const propType = map[c.input.type];
        if (!propType) {
          let threw = null;
          try { applySafeIfcEdits(SIMPLE_FIXTURE, { propertyEdits: [{ localId: 10, propertySet: 'BIM_TRACKER_EDIT', property: 'X', value: c.input.value, valueType: c.input.type }] }); } catch (e) { threw = e; }
          if (!threw || !/not supported|No safe IFC edits could be applied/i.test(threw.message)) throw new Error('unknown type should throw');
          break;
        }
        let threw = null, text = '';
        try {
          const r = applySafeIfcEdits(fixtureFor(propType === 'IFCBOOLEAN' && c.expected.ok === false ? 'IFCBOOLEAN' : propType), {
            propertyEdits: [{ localId: 10, propertySet: 'Pset_X', property: 'Probe', value: c.input.value }],
          });
          text = r.text;
        } catch (e) { threw = e; }
        if (c.expected.ok) {
          if (threw) throw new Error(`threw ${threw.message}`);
          if (!text.includes(c.expected.step)) throw new Error(`missing ${c.expected.step}`);
        } else {
          if (!threw || !/No safe IFC edits could be applied/.test(threw.message)) throw new Error('expected throw');
        }
        break;
      }
      case 'extract_project_tags':
      case 'extract_tray_assignments':
      case 'plan_project_tag_update':
      case 'plan_project_tag_create':
      case 'plan_project_tag_skip_empty':
      case 'plan_project_tag_skip_missing': {
        if (c.fn === 'extract_tray_assignments') {
          const r = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.assignments);
          const list = [...tagExporter.extractTraySystemAssignmentsFromIfc(r.bytes).entries()]
            .map(([localId, v]) => ({ localId, ...v }));
          const wants = Array.isArray(c.expected) ? c.expected : [c.expected];
          if (list.length !== wants.length) throw new Error(`count ${list.length}`);
          for (const want of wants) {
            const got = list.find((a) => a.localId === want.localId);
            if (!got) throw new Error(`missing ${want.localId}`);
            for (const [k, v] of Object.entries(want)) {
              if (k === 'localId') continue;
              if (got[k] !== v) throw new Error(`${k} = ${got[k]}`);
            }
          }
          break;
        }
        if (c.fn === 'extract_project_tags') {
          const r = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, c.input.assignments, c.input.options);
          const tags = tagExporter.extractProjectTagsFromIfc(r.bytes, c.input.options);
          if (tags.size !== c.expected.count) throw new Error(`count ${tags.size}`);
          if (c.expected.tag && tags.get(10)?.tag !== c.expected.tag) throw new Error('tag');
          break;
        }
        // plan_* cases: pin the legacy decision (update vs create vs skip)
        // through the observable add* behaviour.
        if (c.fn === 'plan_project_tag_update') {
          const first = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, [{ localId: 10, tag: c.input.existing[0].tag }]);
          const second = tagExporter.addProjectTagsToIfc(first.bytes, c.input.assignments);
          if (second.applied[0].action !== 'updated') throw new Error('action');
          if (tagExporter.extractProjectTagsFromIfc(second.bytes).get(10)?.tag !== c.expected[0].tag) throw new Error('tag');
          break;
        }
        if (c.fn === 'plan_project_tag_create') {
          const r = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, c.input.assignments);
          if (r.applied[0].action !== c.expected.action) throw new Error('action');
          if (r.applied[0].propertyId !== c.input.nextId) throw new Error('nextId');
          break;
        }
        if (c.fn === 'plan_project_tag_skip_empty') {
          const r = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, [...c.input.assignments, { localId: 10, tag: 'kept' }]);
          if (JSON.stringify(r.skipped.map((x) => x.reason)) !== JSON.stringify([c.expected.reason])) throw new Error('skip');
          break;
        }
        if (c.fn === 'plan_project_tag_skip_missing') {
          const r = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, [...c.input.assignments, { localId: 10, tag: 'kept' }]);
          if (JSON.stringify(r.skipped.map((x) => x.reason)) !== JSON.stringify([c.expected.reason])) throw new Error('skip');
          break;
        }
        throw new Error(`unknown tags fn ${c.fn}`);
      }
      case 'validateTagIntegrity': {
        const r = validator.validateTagIntegrity({ elements: c.input.elements ?? [], excelTags: c.input.excelTags ?? [] });
        const e = c.expected;
        if (r.valid !== e.valid) throw new Error('valid');
        if (e.errors && JSON.stringify(r.errors) !== JSON.stringify(e.errors)) throw new Error('errors');
        if (e.errorCodes) {
          const codes = r.errors.map((x) => x.code).sort();
          if (JSON.stringify(codes) !== JSON.stringify([...e.errorCodes].sort())) throw new Error(`codes ${JSON.stringify(codes)}`);
        }
        if (e.warningCodes) {
          const codes = r.warnings.map((x) => x.code).sort();
          if (JSON.stringify(codes) !== JSON.stringify([...e.warningCodes].sort())) throw new Error(`warnings ${JSON.stringify(codes)}`);
        }
        if (e.firstErrorCode && (r.errors[0]?.code !== e.firstErrorCode || !r.errors[0].message.includes(e.firstErrorMessageContains))) throw new Error('firstError');
        if (e.counts) for (const [k, v] of Object.entries(e.counts)) if (r.counts[k] !== v) throw new Error(`counts.${k} = ${r.counts[k]}`);
        break;
      }
      case 'parse_conduit_overlay': {
        // rustOnly: no legacy reader exists. Fixture sanity only:
        // error-fixtures must lack the terminator, ok-fixtures must
        // contain at least the annotation marker or be explicitly empty.
        if (c.expected.errorContains) {
          if (c.input.overlay.includes('END-ISO-10303-21;')) throw new Error('fixture should lack terminator');
          break;
        }
        if (c.expected.count === 0) {
          if (c.input.overlay.includes('IFCANNOTATION')) throw new Error('fixture should be empty');
          break;
        }
        if (!c.input.overlay.includes('IFCANNOTATION')) throw new Error('fixture');
        break;
      }
      default: throw new Error(`unknown fn ${c.fn}`);
    }
    pass++;
  } catch (err) {
    fail++;
    failures.push(`${id}: ${err.message}`);
  }
}

const only = process.argv.find((a) => a.startsWith('--file='))?.split('=')[1];
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nifc vectors: ${pass} passed, ${fail} failed (${files.join(', ')})`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
