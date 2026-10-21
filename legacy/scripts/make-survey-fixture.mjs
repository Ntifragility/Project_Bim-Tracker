// Writes public/fixtures/survey-box.ifc: two boxes placed at UTM-scale coordinates
// (millimetre file units, site at E 300000 m, N 8600000 m, Z 100 m). Used to check
// that picked points come back in the source file's original coordinates.
//
// Box A spans E 300000..300001, N 8600000..8600002, Z 100..103 (metres).
// Box B is the same box moved +10 m in E.
import fs from 'node:fs';
import path from 'node:path';

const lines = [
  "#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Survey fixture',$,$,$,$,(#11),#7);",
  '#2=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);',
  '#3=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);',
  '#4=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
  '#5=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);',
  '#7=IFCUNITASSIGNMENT((#2,#3,#4,#5));',
  '#8=IFCCARTESIANPOINT((0.,0.,0.));',
  '#9=IFCDIRECTION((0.,0.,1.));',
  '#10=IFCDIRECTION((1.,0.,0.));',
  '#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,\'Model\',3,1.E-05,#12,$);',
  '#12=IFCAXIS2PLACEMENT3D(#8,#9,#10);',
  "#13=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#11,$,.MODEL_VIEW.,$);",
  '#20=IFCCARTESIANPOINT((300000000.,8600000000.,100000.));',
  '#21=IFCAXIS2PLACEMENT3D(#20,$,$);',
  '#22=IFCLOCALPLACEMENT($,#21);',
  "#23=IFCSITE('1YvctVUKr0kugbFTf53O9L',$,'Site',$,$,#22,$,$,.ELEMENT.,$,$,$,$,$);",
  '#24=IFCAXIS2PLACEMENT3D(#8,$,$);',
  '#25=IFCLOCALPLACEMENT(#22,#24);',
  "#26=IFCBUILDING('2YvctVUKr0kugbFTf53O9L',$,'Building',$,$,#25,$,$,.ELEMENT.,$,$,$);",
  '#27=IFCLOCALPLACEMENT(#25,#24);',
  "#28=IFCBUILDINGSTOREY('3YvctVUKr0kugbFTf53O9L',$,'Level 1',$,$,#27,$,$,.ELEMENT.,0.);",
  "#30=IFCRELAGGREGATES('4YvctVUKr0kugbFTf53O9L',$,$,$,#1,(#23));",
  "#31=IFCRELAGGREGATES('5YvctVUKr0kugbFTf53O9L',$,$,$,#23,(#26));",
  "#32=IFCRELAGGREGATES('6YvctVUKr0kugbFTf53O9L',$,$,$,#26,(#28));",
  '#41=IFCCARTESIANPOINT((500.,1000.));',
  '#42=IFCAXIS2PLACEMENT2D(#41,$);',
  '#43=IFCRECTANGLEPROFILEDEF(.AREA.,$,#42,1000.,2000.);',
  '#44=IFCEXTRUDEDAREASOLID(#43,#12,#9,3000.);',
  "#45=IFCSHAPEREPRESENTATION(#13,'Body','SweptSolid',(#44));",
  '#46=IFCPRODUCTDEFINITIONSHAPE($,$,(#45));',
  '#47=IFCLOCALPLACEMENT(#27,#24);',
  "#48=IFCBUILDINGELEMENTPROXY('7YvctVUKr0kugbFTf53O9L',$,'Box A',$,$,#47,#46,$,$);",
  '#50=IFCCARTESIANPOINT((10000.,0.,0.));',
  '#51=IFCAXIS2PLACEMENT3D(#50,$,$);',
  '#52=IFCLOCALPLACEMENT(#27,#51);',
  "#53=IFCBUILDINGELEMENTPROXY('9YvctVUKr0kugbFTf53O9L',$,'Box B',$,$,#52,#46,$,$);",
  "#60=IFCRELCONTAINEDINSPATIALSTRUCTURE('8YvctVUKr0kugbFTf53O9L',$,$,$,(#48,#53),#28);",
];

const ifc = [
  'ISO-10303-21;',
  'HEADER;',
  "FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');",
  "FILE_NAME('survey-box.ifc','2026-10-10T00:00:00',(''),(''),'','','');",
  "FILE_SCHEMA(('IFC4'));",
  'ENDSEC;',
  'DATA;',
  ...lines,
  'ENDSEC;',
  'END-ISO-10303-21;',
  '',
].join('\n');

const out = path.resolve('public/fixtures/survey-box.ifc');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ifc);
console.log(`Wrote ${out}`);
