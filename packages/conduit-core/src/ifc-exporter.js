// IFC Exporter for Conduit Overlay.
// Generates a valid STEP-format IFC (IFC2X3 or IFC4) containing 3D swept conduit
// solids with smooth NEC-radius bends and Pset_ConduitRun properties, federatable in Revizto and BIM viewers.

import { extractRunParts } from './centerline-builder.js';
import { getNecBendRadiusM } from './fitting-solver.js';

const METRES_TO_FEET = 1 / 0.3048;
const STICK_LENGTH_FT = 10;

function escapeStepStr(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function polylineLengthM(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = Number(pts[i].x) - Number(pts[i - 1].x);
    const dy = Number(pts[i].y) - Number(pts[i - 1].y);
    const dz = Number(pts[i].z) - Number(pts[i - 1].z);
    total += Math.hypot(dx, dy, dz);
  }
  return total;
}

function formatIfcDate(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0];
}

function makeGuid(index) {
  // Generate valid 22-char IFC base64 compressed GUID
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let str = '';
  let seed = 100000 + index * 997;
  for (let i = 0; i < 22; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    str += chars[seed % 64];
  }
  return str;
}

function tradeRadiusFromLabel(sizeLabel) {
  const s = String(sizeLabel || '').trim().toLowerCase();
  const mmMatch = s.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (mmMatch) {
    const r = (parseFloat(mmMatch[1]) / 1000) * 0.5;
    if (Number.isFinite(r) && r > 0) return r;
  }
  const table = {
    '1/2"': 0.0105,
    '3/4"': 0.0135,
    '1"': 0.0167,
    '1-1/4"': 0.0211,
    '1-1/2"': 0.0241,
    '2"': 0.0302,
    '2-1/2"': 0.0365,
    '3"': 0.0445,
    '3-1/2"': 0.0508,
    '4"': 0.0572,
  };
  for (const [k, v] of Object.entries(table)) {
    if (s.includes(k)) return v;
  }
  return 0.025;
}

function parseHexRgb(hexStr) {
  const clean = String(hexStr || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { r: 0.9608, g: 0.6196, b: 0.0431, hex: '#f59e0b' }; // Default Amber
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return { r, g, b, hex: `#${clean.toLowerCase()}` };
}

export function exportOverlayIfc({
  runs = [],
  nodes = {},
  schema = 'IFC4',
  projectName = 'Conduit Takeoff Overlay',
  unit = 'METRE',
  toOriginal = null,
  getRunColor = null,
}) {
  const schemaUpper = schema.toUpperCase().includes('2X3') ? 'IFC2X3' : 'IFC4';
  const timestamp = formatIfcDate();

  let idCounter = 1;
  const nextId = () => idCounter++;

  const lines = [];
  const add = (text) => lines.push(text);

  // Header section
  add('ISO-10303-21;');
  add('HEADER;');
  add(`FILE_DESCRIPTION(('Conduit Takeoff 3D Overlay'),'2;1');`);
  add(`FILE_NAME('conduit-overlay.ifc','${timestamp}',('Estimator'),('Project BIM Tracker'),'COVILLAF Conduit Engine','Conduit Takeoff Viewer','');`);
  add(`FILE_SCHEMA(('${schemaUpper}'));`);
  add('ENDSEC;');
  add('DATA;');

  // Base spatial and unit structure
  const orgId = nextId();
  add(`#${orgId}=IFCORGANIZATION($,'Project BIM Tracker',$,$,$);`);

  const appPersonId = nextId();
  add(`#${appPersonId}=IFCPERSON($,'Takeoff User',$,$,$,$,$,$);`);

  const appPersonAndOrgId = nextId();
  add(`#${appPersonAndOrgId}=IFCPERSONANDORGANIZATION(#${appPersonId},#${orgId},$);`);

  const appDefId = nextId();
  add(`#${appDefId}=IFCAPPLICATION(#${orgId},'1.0','Conduit Takeoff Viewer','Conduit Takeoff');`);

  const ownerHistId = nextId();
  add(`#${ownerHistId}=IFCOWNERHISTORY(#${appPersonAndOrgId},#${appDefId},.READWRITE.,.NOTDEFINED.,$,$,$,${Math.floor(Date.now() / 1000)});`);

  const dimExpId = nextId();
  add(`#${dimExpId}=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);`);

  const lengthUnitId = nextId();
  add(`#${lengthUnitId}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);

  const unitAssignId = nextId();
  add(`#${unitAssignId}=IFCUNITASSIGNMENT((#${lengthUnitId}));`);

  const originPtId = nextId();
  add(`#${originPtId}=IFCCARTESIANPOINT((0.,0.,0.));`);

  const axisZId = nextId();
  add(`#${axisZId}=IFCDIRECTION((0.,0.,1.));`);

  const axisXId = nextId();
  add(`#${axisXId}=IFCDIRECTION((1.,0.,0.));`);

  const wcsId = nextId();
  add(`#${wcsId}=IFCAXIS2PLACEMENT3D(#${originPtId},#${axisZId},#${axisXId});`);

  const geomContextId = nextId();
  add(`#${geomContextId}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${wcsId},#${axisZId});`);

  const projectId = nextId();
  add(`#${projectId}=IFCPROJECT('${makeGuid(1)}',#${ownerHistId},'${projectName}',$,$,$,$,(#${geomContextId}),#${unitAssignId});`);

  const siteId = nextId();
  add(`#${siteId}=IFCSITE('${makeGuid(2)}',#${ownerHistId},'Default Site',$,$,#${wcsId},$,$,.ELEMENT.,$,$,$,$,$);`);

  const relProjSiteId = nextId();
  add(`#${relProjSiteId}=IFCRELAGGREGATES('${makeGuid(3)}',#${ownerHistId},$,$,#${projectId},(#${siteId}));`);

  const assemblyEntityIds = [];
  const systemGroups = new Map(); // systemName -> { members: string[], runCount: number, totalLengthM: number, totalSticks10Ft: number }
  const styleAssignmentByHex = new Map(); // '#rrggbb' -> psaId (IFCPRESENTATIONSTYLEASSIGNMENT)
  let guidSeq = 10;

  const isIfc4 = schemaUpper === 'IFC4';

  const getOrCreateStyleAssignment = (hexColor) => {
    const rgb = parseHexRgb(hexColor);
    if (styleAssignmentByHex.has(rgb.hex)) {
      return { psaId: styleAssignmentByHex.get(rgb.hex), hex: rgb.hex };
    }
    const colourId = nextId();
    add(`#${colourId}=IFCCOLOURRGB($,${rgb.r.toFixed(4)},${rgb.g.toFixed(4)},${rgb.b.toFixed(4)});`);
    const renderingId = nextId();
    add(`#${renderingId}=IFCSURFACESTYLERENDERING(#${colourId},0.,$,$,$,$,$,$,.NOTDEFINED.);`);
    const surfStyleId = nextId();
    add(`#${surfStyleId}=IFCSURFACESTYLE('Conduit_${rgb.hex.slice(1)}',.BOTH.,(#${renderingId}));`);
    const psaId = nextId();
    add(`#${psaId}=IFCPRESENTATIONSTYLEASSIGNMENT((#${surfStyleId}));`);
    styleAssignmentByHex.set(rgb.hex, psaId);
    return { psaId, hex: rgb.hex };
  };

  const emitSweptPipePart = (partPts, radiusM, stylePsaId) => {
    const pointIds = [];
    for (const rawPt of partPts) {
      const pt = typeof toOriginal === 'function' ? toOriginal(rawPt) : rawPt;
      const pid = nextId();
      add(`#${pid}=IFCCARTESIANPOINT((${Number(pt.x).toFixed(4)},${Number(pt.y).toFixed(4)},${Number(pt.z).toFixed(4)}));`);
      pointIds.push(`#${pid}`);
    }
    const polylineId = nextId();
    add(`#${polylineId}=IFCPOLYLINE((${pointIds.join(',')}));`);

    const sweptSolidId = nextId();
    add(`#${sweptSolidId}=IFCSWEPTDISKSOLID(#${polylineId},${radiusM.toFixed(4)},$,0.,$);`);

    if (stylePsaId) {
      const styledItemId = nextId();
      add(`#${styledItemId}=IFCSTYLEDITEM(#${sweptSolidId},(#${stylePsaId}),$);`);
    }

    const shapeRepId = nextId();
    add(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${geomContextId},'Body','SweptSolid',(#${sweptSolidId}));`);

    const prodShapeId = nextId();
    add(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    return prodShapeId;
  };

  for (const run of runs) {
    const nodeCoords = (run.nodeIds || [])
      .map((nid) => {
        if (typeof nid === 'object' && nid !== null) return nid;
        if (Array.isArray(nodes)) return nodes.find((n) => n.id === nid);
        return nodes ? nodes[nid] : null;
      })
      .filter(Boolean);

    if (nodeCoords.length < 2) continue;

    const runIdStr = String(run.id ?? `run-${guidSeq}`);
    const runName = run.name || `Run ${runIdStr}`;
    const runSize = run.size || run.diameter || '3/4"';
    const runSystem = run.system || 'Power';
    const computedLenM = polylineLengthM(nodeCoords);
    const runLenM = Number(run.length) > 0 ? Number(run.length) : computedLenM;
    const runLenFt = runLenM * METRES_TO_FEET;
    const sticks10Ft = runLenFt > 0 ? Math.ceil(runLenFt / STICK_LENGTH_FT) : 0;

    const radiusM = tradeRadiusFromLabel(runSize);
    const bendRadiusM = getNecBendRadiusM(runSize);
    const parts = extractRunParts(nodeCoords, bendRadiusM, 12);
    const totalBendDeg = parts.reduce(
      (sum, part) => sum + (part.kind === 'fitting' ? Number(part.bendAngle || 0) : 0),
      0
    );

    const escRunId = escapeStepStr(runIdStr);
    const escRunName = escapeStepStr(runName);
    const escRunSize = escapeStepStr(runSize);
    const escRunSystem = escapeStepStr(runSystem);

    // Per-run property set (attached to assembly + every segment & elbow so clicking any piece shows total trace length)
    const pRunId = nextId();
    add(`#${pRunId}=IFCPROPERTYSINGLEVALUE('RunId',$,IFCLABEL('${escRunId}'),$);`);
    const pRunNameId = nextId();
    add(`#${pRunNameId}=IFCPROPERTYSINGLEVALUE('RunName',$,IFCLABEL('${escRunName}'),$);`);
    const pSizeId = nextId();
    add(`#${pSizeId}=IFCPROPERTYSINGLEVALUE('Size',$,IFCLABEL('${escRunSize}'),$);`);
    const pSystemId = nextId();
    add(`#${pSystemId}=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('${escRunSystem}'),$);`);
    const pLenId = nextId();
    add(`#${pLenId}=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(${runLenM.toFixed(3)}),$);`);
    const pTotalLenMId = nextId();
    add(`#${pTotalLenMId}=IFCPROPERTYSINGLEVALUE('TotalLengthM',$,IFCLENGTHMEASURE(${runLenM.toFixed(3)}),$);`);
    const pTotalLenFtId = nextId();
    add(`#${pTotalLenFtId}=IFCPROPERTYSINGLEVALUE('TotalLengthFt',$,IFCREAL(${runLenFt.toFixed(2)}),$);`);
    const pSticksId = nextId();
    add(`#${pSticksId}=IFCPROPERTYSINGLEVALUE('Sticks10Ft',$,IFCINTEGER(${sticks10Ft}),$);`);
    const pBendDegId = nextId();
    add(`#${pBendDegId}=IFCPROPERTYSINGLEVALUE('TotalBendDeg',$,IFCREAL(${totalBendDeg.toFixed(1)}),$);`);
    const pPartCountId = nextId();
    add(`#${pPartCountId}=IFCPROPERTYSINGLEVALUE('PartCount',$,IFCINTEGER(${parts.length}),$);`);

    const rawColor =
      (typeof getRunColor === 'function' ? getRunColor(run) : null) ||
      run.color ||
      '#f59e0b';
    const { psaId: runStylePsaId, hex: runColorHex } = getOrCreateStyleAssignment(rawColor);

    const pColorId = nextId();
    add(`#${pColorId}=IFCPROPERTYSINGLEVALUE('ColorHex',$,IFCLABEL('${escapeStepStr(runColorHex)}'),$);`);

    const runPsetId = nextId();
    add(
      `#${runPsetId}=IFCPROPERTYSET('${makeGuid(guidSeq++)}',#${ownerHistId},'Pset_ConduitRun',$,` +
      `(#${pRunId},#${pRunNameId},#${pSizeId},#${pSystemId},#${pLenId},#${pTotalLenMId},#${pTotalLenFtId},#${pSticksId},#${pBendDegId},#${pPartCountId},#${pColorId}));`
    );

    // Parent assembly packaging all segments & elbows of this trace from start to end
    const assemblyId = nextId();
    const assemblyLabel = escapeStepStr(`${runName} (${runSize} - ${runLenFt.toFixed(2)} ft)`);
    add(
      `#${assemblyId}=IFCELEMENTASSEMBLY('${makeGuid(guidSeq++)}',#${ownerHistId},'${assemblyLabel}',` +
      `'Conduit Run Assembly (${escRunSystem})',$,#${wcsId},$,'${escRunId}',.NOTDEFINED.,.USERDEFINED.);`
    );
    const assemblyRef = `#${assemblyId}`;
    assemblyEntityIds.push(assemblyRef);

    if (!systemGroups.has(runSystem)) {
      systemGroups.set(runSystem, { members: [], runCount: 0, totalLengthM: 0, totalSticks10Ft: 0 });
    }
    const sysEntry = systemGroups.get(runSystem);
    sysEntry.members.push(assemblyRef);
    sysEntry.runCount += 1;
    sysEntry.totalLengthM += runLenM;
    sysEntry.totalSticks10Ft += sticks10Ft;

    const partEntityRefs = [];
    let segIdx = 1;
    let fitIdx = 1;

    const runSummaryTag = escapeStepStr(`Total: ${runLenFt.toFixed(2)} ft (${runLenM.toFixed(2)} m)`);

    for (const part of parts) {
      const prodShapeId = emitSweptPipePart(part.points, radiusM, runStylePsaId);
      const partId = nextId();
      const partLenM = polylineLengthM(part.points);
      const partLenFt = partLenM * METRES_TO_FEET;

      if (part.kind === 'fitting') {
        const angleLabel = `${Math.round(part.bendAngle || 0)}°`;
        const entityLine = isIfc4
          ? `#${partId}=IFCCABLECARRIERFITTING('${makeGuid(guidSeq++)}',#${ownerHistId},'${escRunName} - Elbow ${fitIdx++}','${angleLabel} Conduit Bend (${escRunSize}) | ${runSummaryTag}',$,#${wcsId},#${prodShapeId},'${escRunSize}',.BEND.);`
          : `#${partId}=IFCFLOWFITTING('${makeGuid(guidSeq++)}',#${ownerHistId},'${escRunName} - Elbow ${fitIdx++}','${angleLabel} Conduit Bend (${escRunSize}) | ${runSummaryTag}',$,#${wcsId},#${prodShapeId},'${escRunSize}');`;
        add(entityLine);

        const pAngleId = nextId();
        add(`#${pAngleId}=IFCPROPERTYSINGLEVALUE('BendAngle',$,IFCREAL(${Number(part.bendAngle || 0).toFixed(2)}),$);`);
        const pRadId = nextId();
        add(`#${pRadId}=IFCPROPERTYSINGLEVALUE('BendRadius',$,IFCLENGTHMEASURE(${Number(part.radiusM || bendRadiusM).toFixed(4)}),$);`);
        const pArcMId = nextId();
        add(`#${pArcMId}=IFCPROPERTYSINGLEVALUE('ArcLengthM',$,IFCLENGTHMEASURE(${partLenM.toFixed(3)}),$);`);
        const pArcFtId = nextId();
        add(`#${pArcFtId}=IFCPROPERTYSINGLEVALUE('ArcLengthFt',$,IFCREAL(${partLenFt.toFixed(2)}),$);`);
        const fitPsetId = nextId();
        add(`#${fitPsetId}=IFCPROPERTYSET('${makeGuid(guidSeq++)}',#${ownerHistId},'Pset_ConduitFitting',$,(#${pAngleId},#${pRadId},#${pArcMId},#${pArcFtId}));`);
        const relFitId = nextId();
        add(`#${relFitId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(#${partId}),#${fitPsetId});`);
      } else {
        const entityLine = isIfc4
          ? `#${partId}=IFCCABLECARRIERSEGMENT('${makeGuid(guidSeq++)}',#${ownerHistId},'${escRunName} - Seg ${segIdx++}','Conduit Segment (${escRunSize}) | ${runSummaryTag}',$,#${wcsId},#${prodShapeId},'${escRunSize}',.CONDUITSEGMENT.);`
          : `#${partId}=IFCFLOWSEGMENT('${makeGuid(guidSeq++)}',#${ownerHistId},'${escRunName} - Seg ${segIdx++}','Conduit Segment (${escRunSize}) | ${runSummaryTag}',$,#${wcsId},#${prodShapeId},'${escRunSize}');`;
        add(entityLine);

        const pSegMId = nextId();
        add(`#${pSegMId}=IFCPROPERTYSINGLEVALUE('SegmentLengthM',$,IFCLENGTHMEASURE(${partLenM.toFixed(3)}),$);`);
        const pSegFtId = nextId();
        add(`#${pSegFtId}=IFCPROPERTYSINGLEVALUE('SegmentLengthFt',$,IFCREAL(${partLenFt.toFixed(2)}),$);`);
        const segPsetId = nextId();
        add(`#${segPsetId}=IFCPROPERTYSET('${makeGuid(guidSeq++)}',#${ownerHistId},'Pset_ConduitSegment',$,(#${pSegMId},#${pSegFtId}));`);
        const relSegId = nextId();
        add(`#${relSegId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(#${partId}),#${segPsetId});`);
      }

      const ref = `#${partId}`;
      partEntityRefs.push(ref);
      sysEntry.members.push(ref);
    }

    if (partEntityRefs.length > 0) {
      // Aggregate all segments & fittings under the run's IFCELEMENTASSEMBLY
      const relAsmId = nextId();
      add(`#${relAsmId}=IFCRELAGGREGATES('${makeGuid(guidSeq++)}',#${ownerHistId},'Conduit Run Parts',$,${assemblyRef},(${partEntityRefs.join(',')}));`);

      // Attach Pset_ConduitRun to BOTH the assembly AND every child piece
      const relDefId = nextId();
      add(`#${relDefId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(${[assemblyRef, ...partEntityRefs].join(',')}),#${runPsetId});`);
    }
  }

  // Group related runs & parts by electrical system (IFCSYSTEM + Pset_ConduitSystem summary)
  for (const [sysName, info] of systemGroups) {
    const escSysName = escapeStepStr(sysName);
    const sysLenFt = info.totalLengthM * METRES_TO_FEET;
    const sysId = nextId();
    add(`#${sysId}=IFCSYSTEM('${makeGuid(guidSeq++)}',#${ownerHistId},'${escSysName}','Electrical Conduit System (${info.runCount} runs, ${sysLenFt.toFixed(2)} ft)',$,$);`);

    const pSysNameId = nextId();
    add(`#${pSysNameId}=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('${escSysName}'),$);`);
    const pSysCountId = nextId();
    add(`#${pSysCountId}=IFCPROPERTYSINGLEVALUE('RunCount',$,IFCINTEGER(${info.runCount}),$);`);
    const pSysLenMId = nextId();
    add(`#${pSysLenMId}=IFCPROPERTYSINGLEVALUE('SystemTotalLengthM',$,IFCLENGTHMEASURE(${info.totalLengthM.toFixed(3)}),$);`);
    const pSysLenFtId = nextId();
    add(`#${pSysLenFtId}=IFCPROPERTYSINGLEVALUE('SystemTotalLengthFt',$,IFCREAL(${sysLenFt.toFixed(2)}),$);`);
    const pSysSticksId = nextId();
    add(`#${pSysSticksId}=IFCPROPERTYSINGLEVALUE('SystemSticks10Ft',$,IFCINTEGER(${info.totalSticks10Ft}),$);`);
    const sysPsetId = nextId();
    add(`#${sysPsetId}=IFCPROPERTYSET('${makeGuid(guidSeq++)}',#${ownerHistId},'Pset_ConduitSystem',$,(#${pSysNameId},#${pSysCountId},#${pSysLenMId},#${pSysLenFtId},#${pSysSticksId}));`);
    const relSysPsetId = nextId();
    add(`#${relSysPsetId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(#${sysId}),#${sysPsetId});`);

    const relSysId = nextId();
    add(`#${relSysId}=IFCRELASSIGNSTOGROUP('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(${info.members.join(',')}),$,#${sysId});`);
  }

  // Relate run assemblies to Site spatial structure
  if (assemblyEntityIds.length > 0) {
    const relContainedId = nextId();
    add(`#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${makeGuid(99)}',#${ownerHistId},'Spatial Container',$,(${assemblyEntityIds.join(',')}),#${siteId});`);
  }

  add('ENDSEC;');
  add('END-ISO-10303-21;');

  return lines.join('\r\n');
}
