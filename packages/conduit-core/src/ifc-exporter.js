// IFC Exporter for Conduit Overlay.
// Generates a valid STEP-format IFC (IFC2X3 or IFC4) containing 3D swept conduit
// solids with smooth NEC-radius bends and Pset_ConduitRun properties, federatable in Revizto and BIM viewers.

import { extractRunParts } from './centerline-builder.js';
import { getNecBendRadiusM } from './fitting-solver.js';

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

export function exportOverlayIfc({
  runs = [],
  nodes = {},
  schema = 'IFC4',
  projectName = 'Conduit Takeoff Overlay',
  unit = 'METRE',
  toOriginal = null,
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

  const runEntityIds = [];
  const systemMembers = new Map(); // systemName -> string[] of '#id'
  let guidSeq = 10;

  const isIfc4 = schemaUpper === 'IFC4';

  const emitSweptPipePart = (partPts, radiusM) => {
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

    const runName = run.name || `Run ${run.id}`;
    const runSize = run.size || run.diameter || '3/4"';
    const runSystem = run.system || 'Power';
    const runLen = Number(run.length || 0).toFixed(3);
    const radiusM = tradeRadiusFromLabel(runSize);
    const bendRadiusM = getNecBendRadiusM(runSize);
    const parts = extractRunParts(nodeCoords, bendRadiusM, 12);

    const pSizeId = nextId();
    add(`#${pSizeId}=IFCPROPERTYSINGLEVALUE('Size',$,IFCLABEL('${runSize}'),$);`);
    const pSystemId = nextId();
    add(`#${pSystemId}=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('${runSystem}'),$);`);
    const pLenId = nextId();
    add(`#${pLenId}=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(${runLen}),$);`);
    const runPsetId = nextId();
    add(`#${runPsetId}=IFCPROPERTYSET('${makeGuid(guidSeq++)}',#${ownerHistId},'Pset_ConduitRun',$,(#${pSizeId},#${pSystemId},#${pLenId}));`);

    const partEntityRefs = [];
    let segIdx = 1;
    let fitIdx = 1;

    for (const part of parts) {
      const prodShapeId = emitSweptPipePart(part.points, radiusM);
      const partId = nextId();
      if (part.kind === 'fitting') {
        const angleLabel = `${Math.round(part.bendAngle || 0)}°`;
        const entityLine = isIfc4
          ? `#${partId}=IFCCABLECARRIERFITTING('${makeGuid(guidSeq++)}',#${ownerHistId},'${runName} - Elbow ${fitIdx++}','${angleLabel} Conduit Bend (${runSize})',$,#${wcsId},#${prodShapeId},'${runSize}',.BEND.);`
          : `#${partId}=IFCFLOWFITTING('${makeGuid(guidSeq++)}',#${ownerHistId},'${runName} - Elbow ${fitIdx++}','${angleLabel} Conduit Bend (${runSize})',$,#${wcsId},#${prodShapeId},'${runSize}');`;
        add(entityLine);

        const pAngleId = nextId();
        add(`#${pAngleId}=IFCPROPERTYSINGLEVALUE('BendAngle',$,IFCREAL(${Number(part.bendAngle || 0).toFixed(2)}),$);`);
        const pRadId = nextId();
        add(`#${pRadId}=IFCPROPERTYSINGLEVALUE('BendRadius',$,IFCLENGTHMEASURE(${Number(part.radiusM || bendRadiusM).toFixed(4)}),$);`);
        const fitPsetId = nextId();
        add(`#${fitPsetId}=IFCPROPERTYSET('${makeGuid(guidSeq++)}',#${ownerHistId},'Pset_ConduitFitting',$,(#${pAngleId},#${pRadId}));`);
        const relFitId = nextId();
        add(`#${relFitId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(#${partId}),#${fitPsetId});`);
      } else {
        const entityLine = isIfc4
          ? `#${partId}=IFCCABLECARRIERSEGMENT('${makeGuid(guidSeq++)}',#${ownerHistId},'${runName} - Seg ${segIdx++}','Conduit Segment (${runSize})',$,#${wcsId},#${prodShapeId},'${runSize}',.CONDUITSEGMENT.);`
          : `#${partId}=IFCFLOWSEGMENT('${makeGuid(guidSeq++)}',#${ownerHistId},'${runName} - Seg ${segIdx++}','Conduit Segment (${runSize})',$,#${wcsId},#${prodShapeId},'${runSize}');`;
        add(entityLine);
      }

      const ref = `#${partId}`;
      runEntityIds.push(ref);
      partEntityRefs.push(ref);
      if (!systemMembers.has(runSystem)) systemMembers.set(runSystem, []);
      systemMembers.get(runSystem).push(ref);
    }

    if (partEntityRefs.length > 0) {
      const relDefId = nextId();
      add(`#${relDefId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(${partEntityRefs.join(',')}),#${runPsetId});`);
    }
  }

  // Group segments and fittings by electrical system (IFCSYSTEM)
  for (const [sysName, members] of systemMembers) {
    if (members.length === 0) continue;
    const sysId = nextId();
    add(`#${sysId}=IFCSYSTEM('${makeGuid(guidSeq++)}',#${ownerHistId},'${sysName}','Electrical Conduit System',$,$);`);
    const relSysId = nextId();
    add(`#${relSysId}=IFCRELASSIGNSTOGROUP('${makeGuid(guidSeq++)}',#${ownerHistId},$,$,(${members.join(',')}),$,#${sysId});`);
  }

  // Relate runs to Site spatial structure
  if (runEntityIds.length > 0) {
    const relContainedId = nextId();
    add(`#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${makeGuid(99)}',#${ownerHistId},'Spatial Container',$,(${runEntityIds.join(',')}),#${siteId});`);
  }

  add('ENDSEC;');
  add('END-ISO-10303-21;');

  return lines.join('\r\n');
}
