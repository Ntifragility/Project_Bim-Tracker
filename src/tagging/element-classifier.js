const FITTING_TEXT = /\b(fittings?|elbow|bend|tee|junction|reducer|transition|curva|codo|derivaci[oó]n)\b/i;
const TRAY_TEXT = /\b(cable\s*tray|tray\s*segment|bandeja(?:\s+de\s+cables?)?|segmento)\b/i;

export function classifyTaggableElement(element = {}) {
  const type = String(element.type || element.category || '').toLowerCase();
  const text = [element.name, element.type, element.objectType, element.family, element.category]
    .filter(Boolean)
    .join(' ');

  if (/ifccablecarrierfitting|ifccablefitting/.test(type)) {
    return { kind: 'fitting', confidence: 1, evidence: 'Standard IFC fitting class' };
  }
  if (/ifccablecarriersegment/.test(type)) {
    return { kind: 'tray', confidence: 1, evidence: 'Standard IFC cable-carrier segment class' };
  }

  const fittingMatch = FITTING_TEXT.test(text);
  const trayMatch = TRAY_TEXT.test(text);
  if (fittingMatch && !trayMatch) {
    return { kind: 'fitting', confidence: 0.72, evidence: 'Element name or property indicates a fitting' };
  }
  if (trayMatch && !fittingMatch) {
    return { kind: 'tray', confidence: 0.72, evidence: 'Element name or property indicates a tray segment' };
  }
  return {
    kind: null,
    confidence: 0,
    evidence: fittingMatch && trayMatch
      ? 'Element metadata contains both tray and fitting terms'
      : 'No reliable tray/fitting indicator found',
  };
}
