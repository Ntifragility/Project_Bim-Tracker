// IFC type-code lookup shared by identity and property display.
//
// The numeric `type` codes are web-ifc internals; the map renders them as
// human-readable `Ifc*` names. Imported by `src/ui/helpers.js`
// (`readElementIdentity` / `getModernIfcTypeName`) and
// `src/ui/properties-panel.js` (legacy `getProperties` fallback path).

// Common IFC type codes → human-readable names
export const IFC_TYPE_MAP = {
  3588315303: 'IfcWall', 103090709: 'IfcWallStandardCase',
  1281925730: 'IfcSlab', 4278956645: 'IfcWindow', 395920057: 'IfcDoor',
  4243806635: 'IfcColumn', 3027567501: 'IfcBeam', 2391406531: 'IfcStair',
  331165859: 'IfcStairFlight', 900683007: 'IfcFooting', 1687234759: 'IfcPile',
  2262370178: 'IfcRailing', 3171933400: 'IfcPlate', 1783015770: 'IfcMember',
  263784265: 'IfcFurnishingElement', 1529196076: 'IfcBuildingElementProxy',
  3573737166: 'IfcRoof', 3758799889: 'IfcCovering', 1051755345: 'IfcCurtainWall',
  1335981549: 'IfcDiscreteAccessory', 4105962743: 'IfcMechanicalFastener',
  3415622556: 'IfcFastener', 843113511: 'IfcColumn',
  4031249490: 'IfcBuilding', 3124254112: 'IfcBuildingStorey',
  3856911033: 'IfcSpace', 1674181508: 'IfcProject', 2706606064: 'IfcSite',
  3508470533: 'IfcFlowTerminal', 3132237377: 'IfcFlowMovingDevice',
  987401354: 'IfcFlowSegment', 707683696: 'IfcFlowFitting',
  2058353004: 'IfcFlowController', 3304561284: 'IfcWindow',
  3512223829: 'IfcWallStandardCase', 1973544240: 'IfcCovering',
  2979338954: 'IfcBuildingElementPart', 1095909175: 'IfcBuildingElementProxy',
  2938176219: 'IfcBurner', 32344328: 'IfcBoiler',
  3649129432: 'IfcDistributionElement', 1945004755: 'IfcDistributionPort',
  3040386961: 'IfcDistributionFlowElement', 3313531582: 'IfcSensorType',
  2188021234: 'IfcFlowMeter', 4136498852: 'IfcCooledBeam',
  4017108033: 'IfcPipeFitting', 3640358203: 'IfcPipeSegment',
  4207607924: 'IfcValve', 2056796094: 'IfcAirTerminal',
  177149247: 'IfcAirTerminalBox', 1060000209: 'IfcLamp',
  1890029508: 'IfcElectricDistributionBoard', 857184966: 'IfcElectricAppliance',
  484807127: 'IfcUnitaryEquipment', 4292641817: 'IfcUnitaryControlElement',
  3415753249: 'IfcSwitchingDevice', 1620046519: 'IfcOutlet',
  3518393246: 'IfcDuctSegment', 342316401: 'IfcDuctFitting',
  3760055223: 'IfcDuctSilencer', 2272882330: 'IfcDamper',
  3902619387: 'IfcChiller', 2474470126: 'IfcMotorConnection',
  2295281155: 'IfcProtectiveDeviceTrippingUnit', 738039164: 'IfcProtectiveDevice',
  1904799276: 'IfcElectricMotor', 3694346114: 'IfcCableSegment',
  1051575348: 'IfcCableCarrierSegment', 635142910: 'IfcCableCarrierFitting',
  1285652485: 'IfcCableFitting', 3296154744: 'IfcChimney',
  2143335405: 'IfcPump', 3132237377: 'IfcFan',
};

// IFC property set / quantity type codes
export const IFCPROPERTYSET = 1451395588;
export const IFCELEMENTQUANTITY = 1883228015;
export const IFCRELDEFINESBYPROPERTIES = 4186316022;

/** Resolve a display type name from modern `getItemsData` output. */
export function getModernIfcTypeName(itemData) {
  const raw = itemData?._category ?? itemData?.Category ?? itemData?.type;
  const category = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
    ? raw.value
    : raw;
  if (typeof category === 'number') return IFC_TYPE_MAP[category] || `IFC Type ${category}`;
  if (typeof category === 'string') {
    const normalized = category.replace(/^IFC/i, 'Ifc').toLowerCase();
    const knownType = Object.values(IFC_TYPE_MAP).find((name) => name.toLowerCase() === normalized);
    if (knownType) return knownType;
    return category.replace(/^IFC/i, 'Ifc');
  }
  return 'IfcElement';
}
