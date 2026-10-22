//! `overlay_read.json` vectors as Rust tests (task 3.2, spec R11, new build).

use super::*;

const SINGLE: &str = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#10=IFCCARTESIANPOINT((0.0000,0.0000,2.5000));\n#11=IFCCARTESIANPOINT((6.0960,0.0000,2.5000));\n#12=IFCPOLYLINE((#10,#11));\n#13=IFCGEOMETRICCURVESET((#12));\n#14=IFCSHAPEREPRESENTATION(#5,'Body','GeometricCurveSet',(#13));\n#15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14));\n#16=IFCANNOTATION('0aaaaaaaaaaaaaaaaaaaaa',#2,'Main Feed','Conduit Polyline',#6,#15,'3/4\"');\n#17=IFCPROPERTYSINGLEVALUE('Size',$,IFCLABEL('3/4\"'),$);\n#18=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('Power'),$);\n#19=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(6.096),$);\n#20=IFCPROPERTYSET('1aaaaaaaaaaaaaaaaaaaaa',#2,'Pset_ConduitRun',$,(#17,#18,#19));\n#21=IFCRELDEFINESBYPROPERTIES('2aaaaaaaaaaaaaaaaaaaaa',#2,$,$,(#16),#20);\nENDSEC;\nEND-ISO-10303-21;\n";

const FULL: &str = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#10=IFCCARTESIANPOINT((0.,0.,0.));\n#11=IFCCARTESIANPOINT((10.,0.,0.));\n#12=IFCPOLYLINE((#10,#11));\n#13=IFCGEOMETRICCURVESET((#12));\n#14=IFCSHAPEREPRESENTATION(#5,'Body','GeometricCurveSet',(#13));\n#15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14));\n#16=IFCANNOTATION('0aaaaaaaaaaaaaaaaaaaaa',#2,'Run 2','Conduit Polyline',#6,#15,'1\"');\n#17=IFCPROPERTYSINGLEVALUE('Elbow45',$,IFCINTEGER(1),$);\n#18=IFCPROPERTYSINGLEVALUE('Elbow90',$,IFCINTEGER(1),$);\n#19=IFCPROPERTYSINGLEVALUE('RiserLength',$,IFCLENGTHMEASURE(1.5),$);\n#20=IFCPROPERTYSINGLEVALUE('Couplings',$,IFCINTEGER(2),$);\n#21=IFCPROPERTYSINGLEVALUE('StickLength',$,IFCLENGTHMEASURE(3.048),$);\n#22=IFCPROPERTYSINGLEVALUE('Size',$,IFCLABEL('1\"'),$);\n#23=IFCPROPERTYSINGLEVALUE('System',$,IFCLABEL('Lighting'),$);\n#24=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(10.0),$);\n#25=IFCPROPERTYSET('1aaaaaaaaaaaaaaaaaaaaa',#2,'Pset_ConduitRun',$,(#17,#18,#19,#20,#21,#22,#23,#24));\n#26=IFCRELDEFINESBYPROPERTIES('2aaaaaaaaaaaaaaaaaaaaa',#2,$,$,(#16),#25);\nENDSEC;\nEND-ISO-10303-21;\n";

#[test]
fn overlay_single_run() {
    let runs = parse_conduit_overlay(SINGLE).unwrap();
    assert_eq!(runs.len(), 1);
    let r = &runs[0];
    assert_eq!(r.name, "Main Feed");
    assert_eq!(r.size, "3/4\"");
    assert_eq!(r.system, "Power");
    assert!((r.length_m - 6.096).abs() < 1e-9);
    assert_eq!(r.points.len(), 2);
    assert_eq!(r.points[0], [0.0, 0.0, 2.5]);
    // old files: stick fields default to 0
    assert_eq!((r.elbow45, r.elbow90, r.couplings), (0, 0, 0));
    assert_eq!(r.stick_length_m, 0.0);
}

#[test]
fn overlay_full_fields() {
    let runs = parse_conduit_overlay(FULL).unwrap();
    assert_eq!(runs.len(), 1);
    let r = &runs[0];
    assert!((r.length_m - 10.0).abs() < 1e-9);
    assert_eq!((r.elbow45, r.elbow90, r.couplings), (1, 1, 2));
    assert!((r.riser_length_m - 1.5).abs() < 1e-9);
    assert!((r.stick_length_m - 3.048).abs() < 1e-9);
}

#[test]
fn overlay_empty() {
    let src = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaaa');\nENDSEC;\nEND-ISO-10303-21;\n";
    assert_eq!(parse_conduit_overlay(src).unwrap().len(), 0);
}

#[test]
fn overlay_no_terminator() {
    let err = parse_conduit_overlay("ISO-10303-21;\nDATA;\n#1=IFCPROJECT('x');\n").unwrap_err();
    assert!(err.message.contains("terminator"));
}
