// Shared application state for Tray Viewer

export const state = {
  activeModel: null,
  loadedModels: [], // { uuid, name, size, model, visible }
  isWireframe: false,
  excelData: [],
  excelColumns: [],
  selectedExcelIdColumn: "",
  selectedExcelRowIndex: null,
  selectedIfcElement: null,
  currentSelectionMap: {},
  lastIsolatedSelectionMap: {},
  isolationActive: false,
  selectedAppearanceColor: "#f54242",
  selectionHighlightColor: localStorage.getItem("bim-selection-highlight-color") || "#6366f1",
  appearanceColorMaps: new Map(),
  continuityHighlightStyleNames: new Set(),
  tagAssignments: new Map(),
  pendingIfcPropertyEdits: new Map(),
  pendingIfcColorEdits: new Map(),
  lastMetadataTemplate: null,
  traySelection: new Map(),
};

export function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
