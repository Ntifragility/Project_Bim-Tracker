// IFC Exporter for Conduit Overlay.
// Generates a valid STEP-format IFC (IFC2X3 or IFC4) containing 3D solid conduits (IfcSweptDiskSolid)
// and polylines with Pset_ConduitRun properties, federatable in Revizto, That Open, Navisworks and BIM viewers.

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

function getConduitRadiusMeters(size) {
  if (!size) return 0.012;
  const s = String(size).toLowerCase().trim();
  if (s.includes('1/2') || s === '16' || s.includes('16mm')) return 0.009;    // ~18mm OD
  if (s.includes('3/4') || s === '21' || s.includes('21mm')) return 0.0117;   // ~23.4mm OD
  if (s === '1' || s.includes('1"') || s === '27') return 0.0148;             // ~29.5mm OD
  if (s.includes('1 1/4') || s.includes('1-1/4') || s === '35') return 0.0192;
  if (s.includes('1 1/2') || s.includes('1-1/2') || s === '41') return 0.0221;
  if (s.startsWith('2') || s === '53') return 0.0279;
  if (s.includes('2 1/2') || s.includes('2-1/2') || s === '63') return 0.0365;
  if (s.startsWith('3') || s === '78') return 0.0445;
  if (s.startsWith('4') || s === '103') return 0.0572;
  return 0.012;
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0.96, g: 0.62, b: 0.04 };
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16) / 255,
      g: parseInt(clean.slice(2, 4), 16) / 255,
      b: parseInt(clean.slice(4, 6), 16) / 255,
    };
  }
  return { r: 0.96, g: 0.62, b: 0.04 };
}

export function exportOverlayIfc({
  runs = [],
  nodes = {},
  schema = 'IFC4',
  projectName = 'Conduit Takeoff Overlay',
  unit = 'METRE',
  toOriginal = null,
  colorMap = null,
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

  // Hierarchical spatial structure: Project -> Site -> Building -> BuildingStorey
  const sitePlacementId = nextId();
  add(`#${sitePlacementId}=IFCLOCALPLACEMENT($,#${wcsId});`);

  const siteId = nextId();
  add(`#${siteId}=IFCSITE('${makeGuid(2)}',#${ownerHistId},'Default Site',$,$,#${sitePlacementId},$,$,.ELEMENT.,$,$,$,$,$);`);

  const relProjSiteId = nextId();
  add(`#${relProjSiteId}=IFCRELAGGREGATES('${makeGuid(3)}',#${ownerHistId},$,$,#${projectId},(#${siteId}));`);

  const bldgPlacementId = nextId();
  add(`#${bldgPlacementId}=IFCLOCALPLACEMENT(#${sitePlacementId},#${wcsId});`);

  const bldgId = nextId();
  add(`#${bldgId}=IFCBUILDING('${makeGuid(4)}',#${ownerHistId},'Default Building',$,$,#${bldgPlacementId},$,$,.ELEMENT.,$,$,$);`);

  const relSiteBldgId = nextId();
  add(`#${relSiteBldgId}=IFCRELAGGREGATES('${makeGuid(5)}',#${ownerHistId},$,$,#${siteId},(#${bldgId}));`);

  const storeyPlacementId = nextId();
  add(`#${storeyPlacementId}=IFCLOCALPLACEMENT(#${bldgPlacementId},#${wcsId});`);

  const storeyId = nextId();
  add(`#${storeyId}=IFCBUILDINGSTOREY('${makeGuid(6)}',#${ownerHistId},'Level 1',$,$,#${storeyPlacementId},$,$,.ELEMENT.,0.);`);

  const relBldgStoreyId = nextId();
  add(`#${relBldgStoreyId}=IFCRELAGGREGATES('${makeGuid(7)}',#${ownerHistId},$,$,#${bldgId},(#${storeyId}));`);

  const containedElementIds = [];
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
    for (const rawPt of nodeCoords) {
      let pt = rawPt;
      if (typeof toOriginal === 'function') {
        try {
          const res = toOriginal(rawPt);
          if (res && Number.isFinite(res.x) && Number.isFinite(res.y) && Number.isFinite(res.z)) {
            pt = res;
          }
        } catch {
          pt = rawPt;
        }
      }
      const pid = nextId();
      add(`#${pid}=IFCCARTESIANPOINT((${Number(pt.x).toFixed(4)},${Number(pt.y).toFixed(4)},${Number(pt.z).toFixed(4)}));`);
      pointIds.push(`#${pid}`);
    }

    const runName = run.name || `Run ${run.id}`;
    const runSize = run.size || run.diameter || '3/4"';
    const runSystem = run.system || 'Power';
    const runLen = Number(run.length || 0).toFixed(3);
    const radiusM = getConduitRadiusMeters(runSize);

    // 1. Directrix Polyline
    const polylineId = nextId();
    add(`#${polylineId}=IFCPOLYLINE((${pointIds.join(',')}));`);

    // 2. Solid 3D Geometry: IfcSweptDiskSolid
    const sweptSolidId = nextId();
    add(`#${sweptSolidId}=IFCSWEPTDISKSOLID(#${polylineId},${radiusM.toFixed(4)},$,$,$);`);

    const shapeRepBodyId = nextId();
    add(`#${shapeRepBodyId}=IFCSHAPEREPRESENTATION(#${geomContextId},'Body','SweptSolid',(#${sweptSolidId}));`);

    const prodShapeFlowId = nextId();
    add(`#${prodShapeFlowId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepBodyId}));`);

    // 3. Physical Placement
    const elemPlacementId = nextId();
    add(`#${elemPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${wcsId});`);

    // 4. Physical 3D MEP Element: IFCFLOWSEGMENT
    const flowGuid = makeGuid(runIdx++);
    const flowSegmentId = nextId();
    if (schemaUpper === 'IFC4') {
      add(`#${flowSegmentId}=IFCFLOWSEGMENT('${flowGuid}',#${ownerHistId},'${runName}','Conduit ${runSize}','${runSize}',#${elemPlacementId},#${prodShapeFlowId},.CONDUITSEGMENT.);`);
    } else {
      add(`#${flowSegmentId}=IFCFLOWSEGMENT('${flowGuid}',#${ownerHistId},'${runName}','Conduit ${runSize}','${runSize}',#${elemPlacementId},#${prodShapeFlowId},$);`);
    }
    containedElementIds.push(`#${flowSegmentId}`);

    // 5. 2D/Axis Curve Annotation (for 2D wireframe drafting overlay & vector test compatibility)
    const curveSetId = nextId();
    add(`#${curveSetId}=IFCGEOMETRICCURVESET((#${polylineId}));`);

    const shapeRepCurveId = nextId();
    add(`#${shapeRepCurveId}=IFCSHAPEREPRESENTATION(#${geomContextId},'Body','GeometricCurveSet',(#${curveSetId}));`);

    const prodShapeAnnotId = nextId();
    add(`#${prodShapeAnnotId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepCurveId}));`);

    const annotGuid = makeGuid(runIdx++);
    const annotationId = nextId();
    add(`#${annotationId}=IFCANNOTATION('${annotGuid}',#${ownerHistId},'${runName}','Conduit Polyline','${runSize}',#${elemPlacementId},#${prodShapeAnnotId});`);
    containedElementIds.push(`#${annotationId}`);

    // 6. Surface Color / Material (trade diameter color)
    const colorHex = colorMap?.[runSize] || '#f59e0b';
    const rgb = hexToRgb(colorHex);
    const colorId = nextId();
    add(`#${colorId}=IFCCOLOURRGB($,${rgb.r.toFixed(3)},${rgb.g.toFixed(3)},${rgb.b.toFixed(3)});`);

    const renderingId = nextId();
    add(`#${renderingId}=IFCSURFACESTYLERENDERING(#${colorId},0.,$,$,$,$,$,$,.NOTDEFINED.);`);

    const surfaceStyleId = nextId();
    add(`#${surfaceStyleId}=IFCSURFACESTYLE('${runName} Style',.BOTH.,(#${renderingId}));`);

    const presStyleAssignId = nextId();
    add(`#${presStyleAssignId}=IFCPRESENTATIONSTYLEASSIGNMENT((#${surfaceStyleId}));`);

    const styledItemId = nextId();
    add(`#${styledItemId}=IFCSTYLEDITEM(#${shapeRepBodyId},(#${presStyleAssignId}),$);`);

    // 7. Pset_ConduitRun properties (attached to both FlowSegment and Annotation)
    const pSizeId = nextId();
    add(`#${pSizeId}=IFCPROPERTYSINGLEVALUE('Size',$,IFCLABEL('${runSize}'),$);`);

    const pSystemId = nextId();
    add(`#${pSystemId}=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('${runSystem}'),$);`);

    const pLenId = nextId();
    add(`#${pLenId}=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(${runLen}),$);`);

    const pDiameterId = nextId();
    add(`#${pDiameterId}=IFCPROPERTYSINGLEVALUE('OuterDiameter',$,IFCLENGTHMEASURE(${(radiusM * 2).toFixed(4)}),$);`);

    const psetId = nextId();
    add(`#${psetId}=IFCPROPERTYSET('${makeGuid(runIdx++)}',#${ownerHistId},'Pset_ConduitRun',$,(#${pSizeId},#${pSystemId},#${pLenId},#${pDiameterId}));`);

    const relDefId = nextId();
    add(`#${relDefId}=IFCRELDEFINESBYPROPERTIES('${makeGuid(runIdx++)}',#${ownerHistId},$,$,(#${flowSegmentId},#${annotationId}),#${psetId});`);
  }

  // Relate elements to BuildingStorey spatial structure
  if (containedElementIds.length > 0) {
    const relContainedId = nextId();
    add(`#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${makeGuid(99)}',#${ownerHistId},'Spatial Container',$,(${containedElementIds.join(',')}),#${storeyId});`);
  }

  add('ENDSEC;');
  add('END-ISO-10303-21;');

  return lines.join('\r\n');
}
