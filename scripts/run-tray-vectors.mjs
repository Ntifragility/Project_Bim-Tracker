// Task 2.2 vector runner: executes spec/vectors/tray/*.json against legacy JS.
//
// Usage: node scripts/run-tray-vectors.mjs [--file tagging|validator|routing|ifc-io]
//
// Each vector case runs the named legacy function and compares against
// `expected` with the case `tol`. Reports pass/fail per case + summary.
// Exit code 1 on any failure. ifc-io.json cases are jsOnly by design
// (GUID randomness, STEP text rendering stay TS-side).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/tray');

const LEG_PKG = path.join(ROOT, 'legacy/packages/routing-core/src');
const LEG_SRC = path.join(ROOT, 'legacy/src');
const routing = await import(path.join(LEG_PKG, 'index.js'));
const vector = await import(path.join(LEG_PKG, 'vector.js'));
const scheme = await import(path.join(LEG_SRC, 'tagging/tag-scheme.js'));
const classifier = await import(path.join(LEG_SRC, 'tagging/element-classifier.js'));
const validator = await import(path.join(LEG_SRC, 'ifc/tag-validator.js'));
const tagExporter = await import(path.join(LEG_SRC, 'ifc/ifc-tag-exporter.js'));
const safeEditor = await import(path.join(LEG_SRC, 'ifc/ifc-safe-editor.js'));

let pass = 0, fail = 0;
const failures = [];

function close(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function checkPoint(actual, expected, tol, label) {
  for (const k of ['x', 'y', 'z']) {
    if (expected[k] === undefined) continue;
    if (!close(actual[k], expected[k], tol)) {
      throw new Error(`${label}.${k}: ${actual[k]} != ${expected[k]} (tol ${tol})`);
    }
  }
}

// Minimal IFC fixtures matching the legacy tests (entity ids #1/#10 stable).
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

const SHAPED_FIXTURE = `ISO-10303-21;
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

const MAPPED_STYLED_FIXTURE = SHAPED_FIXTURE
  .replace('#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));', '#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#31));')
  .replace("#21=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#22));", [
    "#21=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#22));",
    '#25=IFCAXIS2PLACEMENT3D(#26,$,$);',
    '#26=IFCCARTESIANPOINT((0.,0.,0.));',
    '#27=IFCREPRESENTATIONMAP(#25,#21);',
    '#28=IFCCARTESTANTRANSFORMATIONOPERATOR3D($,$,#26,1.,$);'.replace('CARTESTAN', 'CARTESIAN'),
    '#29=IFCMAPPEDITEM(#27,#28);',
    "#31=IFCSHAPEREPRESENTATION(#30,'Body','MappedRepresentation',(#29));",
    '#32=IFCSTYLEDITEM(#22,(#33),$);',
    '#33=IFCPRESENTATIONSTYLEASSIGNMENT((#34));',
    "#34=IFCSURFACESTYLE('Original',.BOTH.,(#35));",
    '#35=IFCSURFACESTYLERENDERING(#36,0.,#36,$,$,$,$,$,$);',
    '#36=IFCCOLOURRGB($,0.1,0.2,0.3);',
  ].join('\n'));

function resolveNodeId(graph, ref) {
  // refs: edge-start:<id>, edge-end:<id>, or literal node id
  if (!ref || !ref.includes(':')) return ref;
  const [kind, id] = ref.split(':');
  const edge = graph.edges.get(id);
  if (!edge) throw new Error(`unknown edge ${id}`);
  return kind === 'edge-start' ? edge.from : edge.to;
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  // rustOnly: no importable legacy counterpart (new UI-state behaviour with no
  // legacy JS function, e.g. tagging-state.json). Verified in Rust
  // (`cargo test -p tray-tagging`); skipped here, mirroring the jsOnly idea.
  if (c.rustOnly) {
    pass++;
    return;
  }
  const tol = c.tol ?? 1e-9;
  try {
    switch (c.fn) {
      case 'getSystemTag': {
        if (scheme.getSystemTag(c.input.scheme) !== c.expected) throw new Error('systemTag');
        break;
      }
      case 'formatElementTag': {
        const r = scheme.formatElementTag({ systemTag: c.input.systemTag, typeCode: c.input.typeCode, sequenceNumber: c.input.sequenceNumber, separator: c.input.separator });
        if (r !== c.expected) throw new Error(`got ${r}`);
        break;
      }
      case 'parseGeneratedElementTag': {
        const r = scheme.parseGeneratedElementTag(c.input.value, c.input.scheme);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'normalizeTagScheme': {
        const r = scheme.normalizeTagScheme(c.input);
        for (const [k, v] of Object.entries(c.expected)) {
          if (JSON.stringify(r[k]) !== JSON.stringify(v)) throw new Error(`${k}: ${JSON.stringify(r[k])}`);
        }
        break;
      }
      case 'validateTagScheme': {
        const r = scheme.validateTagScheme(c.input);
        if (r.valid !== c.expected.valid) throw new Error('valid');
        if (c.expected.errors && JSON.stringify(r.errors) !== JSON.stringify(c.expected.errors)) throw new Error(`errors ${JSON.stringify(r.errors)}`);
        if (c.expected.errorsContains && !r.errors.some((e) => e.includes(c.expected.errorsContains))) throw new Error(`errors ${JSON.stringify(r.errors)}`);
        break;
      }
      case 'allocateElementTags': {
        const r = scheme.allocateElementTags({ elements: c.input.elements, elementKind: c.input.elementKind, scheme: c.input.scheme, existingAssignments: c.input.existingAssignments });
        if (r.valid !== c.expected.valid) throw new Error('valid');
        if (c.expected.elementTags && JSON.stringify(r.assignments.map((a) => a.elementTag)) !== JSON.stringify(c.expected.elementTags)) {
          throw new Error(`tags ${JSON.stringify(r.assignments.map((a) => a.elementTag))}`);
        }
        if (c.expected.errorsContains && !r.errors.some((e) => e.includes(c.expected.errorsContains))) throw new Error(`errors ${JSON.stringify(r.errors)}`);
        if (c.expected.schemeVersion && !r.assignments.every((a) => a.schemeVersion === c.expected.schemeVersion)) throw new Error('schemeVersion');
        if (c.expected.componentIdEqualsElementTag && !r.assignments.every((a) => a.componentId === a.elementTag)) throw new Error('componentId');
        break;
      }
      case 'classifyTaggableElement': {
        const r = classifier.classifyTaggableElement(c.input.element);
        if (r.kind !== c.expected.kind || r.confidence !== c.expected.confidence) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'validateTagIntegrity': {
        const r = validator.validateTagIntegrity({ elements: c.input.elements ?? [], excelTags: c.input.excelTags ?? [] });
        const e = c.expected;
        if (r.valid !== e.valid) throw new Error('valid');
        if (e.errors && JSON.stringify(r.errors) !== JSON.stringify(e.errors)) throw new Error('errors');
        if (e.errorCodes && JSON.stringify(r.errors.map((x) => x.code)) !== JSON.stringify(e.errorCodes)) throw new Error(`codes ${JSON.stringify(r.errors.map((x) => x.code))}`);
        if (e.warnings && JSON.stringify(r.warnings) !== JSON.stringify(e.warnings)) throw new Error('warnings');
        if (e.warningCodes && JSON.stringify(r.warnings.map((x) => x.code)) !== JSON.stringify(e.warningCodes)) throw new Error('warnings');
        if (e.firstErrorCode && (r.errors[0]?.code !== e.firstErrorCode || !r.errors[0].message.includes(e.firstErrorMessageContains))) throw new Error('firstError');
        if (e.counts) for (const [k, v] of Object.entries(e.counts)) if (r.counts[k] !== v) throw new Error(`counts.${k} = ${r.counts[k]}`);
        break;
      }
      case 'vec.add':
      case 'vec.sub':
      case 'vec.mean': {
        const op = c.fn.split('.')[1];
        const r = op === 'mean' ? vector.mean(c.input.points) : vector[op](c.input.a, c.input.b);
        checkPoint(r, c.expected, tol, op);
        break;
      }
      case 'vec.dot':
      case 'vec.distance': {
        const op = c.fn.split('.')[1];
        const r = op === 'dot' ? vector.dot(c.input.a, c.input.b) : vector.distance(c.input.a, c.input.b);
        if (!close(r, c.expected, tol)) throw new Error(`${op} ${r}`);
        break;
      }
      case 'vec.normalize': {
        checkPoint(vector.normalize(c.input.a), c.expected, tol, 'normalize');
        break;
      }
      case 'deriveCenterline': {
        const r = routing.deriveCenterline(c.input.points, c.input.options ?? {});
        const e = c.expected;
        if (r.valid !== e.valid) throw new Error('valid');
        if (!r.valid) {
          if (r.reason !== e.reason) throw new Error(`reason ${r.reason}`);
          if (e.length !== undefined && !close(r.length, e.length, tol)) throw new Error('length');
          break;
        }
        if (e.length !== undefined && !close(r.length, e.length, tol)) throw new Error(`length ${r.length}`);
        if (e.confidence !== undefined && !close(r.confidence, e.confidence, tol)) throw new Error('confidence');
        if (e.confidenceGt !== undefined && !(r.confidence > e.confidenceGt)) throw new Error('confidence');
        if (e.centroid) checkPoint(r.centroid, e.centroid, tol, 'centroid');
        if (e.start) checkPoint(r.start, e.start, tol, 'start');
        if (e.end) checkPoint(r.end, e.end, tol, 'end');
        break;
      }
      case 'buildConnectivityGraph': {
        const g = routing.buildConnectivityGraph(c.input.segments, c.input.options ?? {});
        const e = c.expected;
        if (e.tolerance !== undefined && g.tolerance !== e.tolerance) throw new Error('tolerance');
        if (e.nodeCount !== undefined && g.nodes.size !== e.nodeCount) throw new Error(`nodes ${g.nodes.size}`);
        if (e.edgeCount !== undefined && g.edges.size !== e.edgeCount) throw new Error('edges');
        if (e.edgeA) {
          const ids = [...g.nodes.keys()];
          const a = g.edges.get('a');
          if (a.from !== ids[e.edgeA.fromNodeIndex] || a.to !== ids[e.edgeA.toNodeIndex]) throw new Error(`edgeA ${a.from}->${a.to}`);
        }
        break;
      }
      case 'diagnoseGraph': {
        const g = routing.buildConnectivityGraph(c.input.segments, c.input.options ?? {});
        const d = routing.diagnoseGraph(g, c.input.options ?? {});
        const e = c.expected;
        if (e.segmentCount !== undefined && d.segmentCount !== e.segmentCount) throw new Error('segments');
        if (e.nodeCount !== undefined && d.nodeCount !== e.nodeCount) throw new Error('nodes');
        if (e.componentCount !== undefined && d.componentCount !== e.componentCount) throw new Error('components');
        if (e.danglingCount !== undefined && d.danglingNodes.length !== e.danglingCount) throw new Error('dangling');
        if (e.ambiguousCount !== undefined && d.ambiguousNodes.length !== e.ambiguousCount) throw new Error('ambiguous');
        if (e.lowConfidenceEdges && JSON.stringify(d.lowConfidenceEdges) !== JSON.stringify(e.lowConfidenceEdges)) throw new Error('lowConf');
        if (e.isConnected !== undefined && d.isConnected !== e.isConnected) throw new Error('connected');
        break;
      }
      case 'connectedComponents': {
        const g = routing.buildConnectivityGraph(c.input.segments, c.input.options ?? {});
        const cc = routing.connectedComponents(g);
        if (cc.length !== c.expected.componentCount) throw new Error('count');
        if (c.expected.edgeSizes && JSON.stringify(cc.map((x) => x.edgeIds.size)) !== JSON.stringify(c.expected.edgeSizes)) throw new Error('sizes');
        break;
      }
      case 'shortestPath': {
        const g = routing.buildConnectivityGraph(c.input.segments, c.input.options ?? {});
        const from = resolveNodeId(g, c.input.from);
        const to = resolveNodeId(g, c.input.to);
        const r = routing.shortestPath(g, from, to, { excludeEdgeIds: c.input.excludeEdgeIds ?? [] });
        const e = c.expected;
        if (r.found !== e.found) throw new Error('found');
        if (!r.found) {
          if (r.reason !== e.reason) throw new Error(`reason ${r.reason}`);
          break;
        }
        if (JSON.stringify(r.edgeIds) !== JSON.stringify(e.edgeIds)) throw new Error(`edges ${JSON.stringify(r.edgeIds)}`);
        if (!close(r.length, e.length, tol)) throw new Error(`length ${r.length}`);
        break;
      }
      case 'createIfcGuid.shape': {
        const g = tagExporter.createIfcGuid();
        if (!new RegExp(c.expected.pattern).test(g)) throw new Error(`guid ${g}`);
        break;
      }
      case 'taggedIfcFileName':
      case 'editedIfcFileName': {
        const fn = c.fn === 'taggedIfcFileName' ? tagExporter.taggedIfcFileName : safeEditor.editedIfcFileName;
        c.input.queries.forEach((q, i) => {
          if (fn(q) !== c.expected[i]) throw new Error(`${q} -> ${fn(q)}`);
        });
        break;
      }
      case 'addProjectTagsToIfc.created': {
        const r = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, c.input.assignments);
        const e = c.expected;
        r.applied.forEach((a, i) => {
          for (const [k, v] of Object.entries(e.applied[i])) if (a[k] !== v) throw new Error(`applied[${i}].${k}`);
        });
        if (!r.text.includes(e.propertyLine)) throw new Error('property line');
        if (!r.text.includes(e.psetName)) throw new Error('pset');
        if (!new RegExp(e.relationPattern).test(r.text)) throw new Error('relation');
        break;
      }
      case 'addProjectTagsToIfc.update': {
        const first = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, [{ localId: c.input.localId, tag: c.input.first }]);
        const existing = tagExporter.extractProjectTagsFromIfc(first.bytes);
        if (existing.get(c.input.localId)?.tag !== c.input.first) throw new Error('first extract');
        const second = tagExporter.addProjectTagsToIfc(first.bytes, [{ localId: c.input.localId, tag: c.input.second }]);
        if (second.applied[0].action !== c.expected.secondAction) throw new Error('action');
        if (tagExporter.extractProjectTagsFromIfc(second.bytes).get(c.input.localId)?.tag !== c.expected.tagAfter) throw new Error('tag');
        if ((second.text.match(/'CCP_TAG'/g) || []).length !== c.expected.ccpTagCount) throw new Error('pset dup');
        break;
      }
      case 'addProjectTagsToIfc.quote':
      case 'addProjectTagsToIfc.empty': {
        const r = tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, c.input.assignments);
        const tags = tagExporter.extractProjectTagsFromIfc(r.bytes);
        if (c.expected.stepContains && !r.text.includes(c.expected.stepContains)) throw new Error('step');
        if (c.expected.skippedReasons && JSON.stringify(r.skipped.map((x) => x.reason)) !== JSON.stringify(c.expected.skippedReasons)) throw new Error('skipped');
        if (c.expected.appliedAction && r.applied[0].action !== c.expected.appliedAction) throw new Error('action');
        if (tags.get(10)?.tag !== c.expected.tagAfter) throw new Error('tag');
        break;
      }
      case 'addProjectTagsToIfc.missing': {
        let threw = null;
        try { tagExporter.addProjectTagsToIfc(SIMPLE_FIXTURE, c.input.assignments); } catch (e) { threw = e; }
        if (!threw || !new RegExp(c.expected.throwsPattern).test(threw.message)) throw new Error('no-throw');
        break;
      }
      case 'addTraySystemAssignmentsToIfc.created': {
        const r = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.assignments);
        if (r.applied[0].action !== c.expected.action) throw new Error('action');
        for (const line of c.expected.propertyLines) if (!r.text.includes(line)) throw new Error(`missing ${line}`);
        if (!r.text.includes(c.expected.psetName) || !r.text.includes(c.expected.psetRef)) throw new Error('pset');
        if (!r.text.includes(c.expected.nativeTagLine)) throw new Error('native tag');
        break;
      }
      case 'addTraySystemAssignmentsToIfc.roundtrip': {
        const r = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.assignments);
        const got = tagExporter.extractTraySystemAssignmentsFromIfc(r.bytes).get(10);
        for (const [k, v] of Object.entries(c.expected)) if (got[k] !== v) throw new Error(`${k} = ${got[k]}`);
        break;
      }
      case 'addTraySystemAssignmentsToIfc.update': {
        const first = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.first);
        const second = tagExporter.addTraySystemAssignmentsToIfc(first.bytes, c.input.second);
        if (second.applied[0].action !== c.expected.secondAction) throw new Error('action');
        const got = tagExporter.extractTraySystemAssignmentsFromIfc(second.bytes).get(10);
        if (got.systemTag !== c.expected.systemTag || got.componentId !== c.expected.componentId) throw new Error('fields');
        if ((second.text.match(/'CCP_TRAY_SYSTEM'/g) || []).length !== c.expected.ccpTraySystemCount) throw new Error('dup');
        break;
      }
      case 'addTraySystemAssignmentsToIfc.delete': {
        const first = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.first);
        const gone = tagExporter.addTraySystemAssignmentsToIfc(first.bytes, c.input.second);
        if (gone.applied[0].action !== c.expected.action) throw new Error('action');
        if (tagExporter.extractTraySystemAssignmentsFromIfc(gone.bytes).has(10) !== c.expected.stillAssigned) throw new Error('assigned');
        for (const s of c.expected.stepContains) if (!gone.text.includes(s)) throw new Error(`missing ${s}`);
        if ((gone.text.match(/'CCP_TRAY_SYSTEM'/g) || []).length !== c.expected.ccpTraySystemCount) throw new Error('dup');
        break;
      }
      case 'addTraySystemAssignmentsToIfc.incomplete':
      case 'addTraySystemAssignmentsToIfc.missing': {
        if (c.fn.endsWith('incomplete')) {
          let threw = null;
          try { tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.assignments); } catch (e) { threw = e; }
          if (!threw || !new RegExp(c.expected.throwsPattern).test(threw.message)) throw new Error('no-throw');
        } else {
          const r = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.assignments);
          if (JSON.stringify(r.skipped.map((x) => x.reason)) !== JSON.stringify(c.expected.skippedReasons)) throw new Error('skipped');
          if (r.applied[0].action !== c.expected.appliedAction) throw new Error('action');
        }
        break;
      }
      case 'addTraySystemAssignmentsToIfc.originalTag': {
        const r = tagExporter.addTraySystemAssignmentsToIfc(SIMPLE_FIXTURE, c.input.assignments);
        for (const s of c.expected.stepContains) if (!r.text.includes(s)) throw new Error(`missing ${s}`);
        break;
      }
      case 'applySafeIfcEdits.update': {
        const r = safeEditor.applySafeIfcEdits(SHAPED_FIXTURE, c.input);
        if (r.applied[0].kind !== c.expected.appliedKind || r.applied[0].action !== c.expected.action) throw new Error('applied');
        if (!r.text.includes(c.expected.stepContains)) throw new Error('step');
        break;
      }
      case 'applySafeIfcEdits.newProperty': {
        const r = safeEditor.applySafeIfcEdits(SHAPED_FIXTURE, c.input);
        if (r.applied[0].kind !== c.expected.appliedKind || r.applied[0].action !== c.expected.action) throw new Error('applied');
        if (r.applied[0].valueType !== c.expected.valueType) throw new Error('valueType');
        if (!r.text.includes(c.expected.propertyLine)) throw new Error('property line');
        if (!new RegExp(c.expected.psetPattern).test(r.text)) throw new Error('pset');
        if (!new RegExp(c.expected.relationPattern).test(r.text)) throw new Error('relation');
        break;
      }
      case 'applySafeIfcEdits.color': {
        const r = safeEditor.applySafeIfcEdits(SHAPED_FIXTURE, c.input);
        if (r.applied[0].kind !== c.expected.appliedKind || r.applied[0].action !== c.expected.action) throw new Error('applied');
        if (r.applied[0].itemCount !== c.expected.itemCount) throw new Error('items');
        for (const s of c.expected.stepContains) if (!r.text.includes(s)) throw new Error(`missing ${s}`);
        break;
      }
      case 'applySafeIfcEdits.updateStyle': {
        const r = safeEditor.applySafeIfcEdits(MAPPED_STYLED_FIXTURE, c.input);
        if (r.applied[0].action !== c.expected.action) throw new Error('action');
        for (const s of c.expected.stepContains) if (!r.text.includes(s)) throw new Error(`missing ${s}`);
        if ((r.text.match(/IFCSTYLEDITEM/g) || []).length !== c.expected.styledItemCount) throw new Error('styled count');
        break;
      }
      case 'applySafeIfcEdits.invalidBoolean':
      case 'applySafeIfcEdits.nonCustomPset':
      case 'applySafeIfcEdits.invalidLocalId': {
        const fixture = c.fn === 'applySafeIfcEdits.invalidBoolean'
          ? SHAPED_FIXTURE.replace("IFCLABEL('Old')", 'IFCBOOLEAN(.F.)')
          : SHAPED_FIXTURE;
        let threw = null;
        try { safeEditor.applySafeIfcEdits(fixture, c.input); } catch (e) { threw = e; }
        if (!threw || !new RegExp(c.expected.throwsPattern).test(threw.message)) throw new Error('no-throw');
        break;
      }
      case 'applySafeIfcEdits.invalidInteger':
      case 'applySafeIfcEdits.invalidColor': {
        const r = safeEditor.applySafeIfcEdits(SHAPED_FIXTURE, c.input);
        if (c.expected.appliedCount !== undefined && r.applied.length !== c.expected.appliedCount) throw new Error('applied');
        if (c.expected.appliedKinds && JSON.stringify(r.applied.map((a) => a.kind)) !== JSON.stringify(c.expected.appliedKinds)) throw new Error('kinds');
        if (!r.skipped.some((x) => new RegExp(c.expected.skippedPattern).test(x.reason))) throw new Error(`skipped ${JSON.stringify(r.skipped)}`);
        break;
      }
      case 'applySafeIfcEdits.typedMetadata': {
        const r = safeEditor.applySafeIfcEdits(SHAPED_FIXTURE, c.input);
        if (r.applied.length !== c.expected.appliedCount) throw new Error('applied');
        for (const s of c.expected.stepContains) if (!r.text.includes(s)) throw new Error(`missing ${s}`);
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

console.log(`\ntray vectors: ${pass} passed, ${fail} failed (${files.join(', ')})`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
