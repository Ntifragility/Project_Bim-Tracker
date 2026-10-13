// IFC Exporter for Conduit Overlay.
// Generates a valid STEP-format IFC (IFC2X3 or IFC4) containing 3D polylines
// for traced conduit runs with Pset_ConduitRun properties, federatable in Revizto and BIM viewers.

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

export function exportOverlayIfc({
  runs = [],
  nodes = {},
  schema = 'IFC4',
  projectName = 'Conduit Takeoff Overlay',
  unit = 'METRE',
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
  let runIdx = 10;

  for (const run of runs) {
    const nodeCoords = (run.nodeIds || [])
      .map((nid) => {
        if (typeof nid === 'object' && nid !== null) return nid;
        if (Array.isArray(nodes)) return nodes.find((n) => n.id === nid);
        return nodes ? nodes[nid] : null;
      })
      .filter(Boolean);

    if (nodeCoords.length < 2) continue;

    // Create Cartesian points for vertices
    const pointIds = [];
    for (const pt of nodeCoords) {
      const pid = nextId();
      add(`#${pid}=IFCCARTESIANPOINT((${Number(pt.x).toFixed(4)},${Number(pt.y).toFixed(4)},${Number(pt.z).toFixed(4)}));`);
      pointIds.push(`#${pid}`);
    }

    // Polyline
    const polylineId = nextId();
    add(`#${polylineId}=IFCPOLYLINE((${pointIds.join(',')}));`);

    // Geometric curve set
    const curveSetId = nextId();
    add(`#${curveSetId}=IFCGEOMETRICCURVESET((#${polylineId}));`);

    // Shape representation
    const shapeRepId = nextId();
    add(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${geomContextId},'Body','GeometricCurveSet',(#${curveSetId}));`);

    // Product definition shape
    const prodShapeId = nextId();
    add(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

    // Annotation product
    const runGuid = makeGuid(runIdx++);
    const annotationId = nextId();
    const runName = run.name || `Run ${run.id}`;
    const runSize = run.size || run.diameter || '3/4"';
    const runSystem = run.system || 'Power';
    const runLen = Number(run.length || 0).toFixed(3);

    add(`#${annotationId}=IFCANNOTATION('${runGuid}',#${ownerHistId},'${runName}','Conduit Polyline',#${wcsId},#${prodShapeId},'${runSize}');`);
    runEntityIds.push(`#${annotationId}`);

    // Pset_ConduitRun properties
    const pSizeId = nextId();
    add(`#${pSizeId}=IFCPROPERTYSINGLEVALUE('Size',$,IFCLABEL('${runSize}'),$);`);

    const pSystemId = nextId();
    add(`#${pSystemId}=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('${runSystem}'),$);`);

    const pLenId = nextId();
    add(`#${pLenId}=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(${runLen}),$);`);

    const psetId = nextId();
    add(`#${psetId}=IFCPROPERTYSET('${makeGuid(runIdx++)}',#${ownerHistId},'Pset_ConduitRun',$,(#${pSizeId},#${pSystemId},#${pLenId}));`);

    const relDefId = nextId();
    add(`#${relDefId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(runIdx++)}',#${ownerHistId},$,$,(#${annotationId}),#${psetId});`);
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
