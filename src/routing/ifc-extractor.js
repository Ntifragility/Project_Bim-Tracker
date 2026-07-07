import * as THREE from 'three';
import { deriveCenterline } from '../../packages/routing-core/src/index.js';

const STANDARD_TRAY_CATEGORY = /IFCCABLECARRIERSEGMENT|IFCCABLECARRIERFITTING/i;
const REVIZTO_PART_CATEGORY = /IFCBUILDINGELEMENTPART/i;
const TRAY_TEXT = /cable\s*tray|bandeja\s+de\s+cables?/i;

function unwrap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && 'value' in value
    ? value.value
    : value;
}

function collectText(value, output = [], visited = new Set()) {
  if (value === null || value === undefined || visited.has(value)) return output;
  if (typeof value === 'string') output.push(value);
  if (typeof value !== 'object') return output;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output, visited));
  } else {
    Object.values(value).forEach((item) => collectText(unwrap(item), output, visited));
  }
  return output;
}

function localIdOf(data) {
  return Number(unwrap(data?._localId ?? data?.expressID ?? data?.localId));
}

function categoryOf(data) {
  return String(unwrap(data?._category ?? data?.Category ?? '') || '');
}

function isTrayData(data) {
  const category = categoryOf(data);
  if (STANDARD_TRAY_CATEGORY.test(category)) return true;
  if (!REVIZTO_PART_CATEGORY.test(category)) return false;
  return TRAY_TEXT.test(collectText(data).join(' '));
}

async function getWorldVertices(model, localId) {
  const geometry = await model.getItem(localId).getGeometry();
  if (!geometry) return [];
  const vertexGroups = await geometry.getVertices();
  if (!vertexGroups?.length) return [];
  const transforms = await geometry.getTransform();
  model.object.updateMatrixWorld(true);

  const result = [];
  vertexGroups.forEach((vertices, index) => {
    const sampleTransform = transforms?.[index] || new THREE.Matrix4();
    for (const vertex of vertices) {
      const transformed = vertex.clone().applyMatrix4(sampleTransform).applyMatrix4(model.object.matrixWorld);
      result.push({ x: transformed.x, y: transformed.y, z: transformed.z });
    }
  });
  return result;
}

export async function extractTraySegments(model, options = {}) {
  const categoryMap = await model.getItemsOfCategories([
    /IFCCABLECARRIERSEGMENT/i,
    /IFCCABLECARRIERFITTING/i,
    /IFCBUILDINGELEMENTPART/i,
  ]);
  const candidateIds = [...new Set(Object.values(categoryMap).flat())];
  if (!candidateIds.length) return { segments: [], rejected: [], candidateCount: 0 };

  const dataItems = await model.getItemsData(candidateIds, {
    attributesDefault: true,
    relations: {
      IsDefinedBy: { attributes: true, relations: true },
      DefinesOccurrence: { attributes: true, relations: true },
    },
    relationsDefault: { attributes: false, relations: false },
  });
  const dataById = new Map(dataItems.map((data, index) => [localIdOf(data) || candidateIds[index], data]));

  const segments = [];
  const rejected = [];
  for (const localId of candidateIds) {
    const data = dataById.get(Number(localId)) || {};
    if (!isTrayData(data)) {
      rejected.push({ localId, reason: 'not-identified-as-cable-tray' });
      continue;
    }

    const vertices = await getWorldVertices(model, Number(localId));
    const centerline = deriveCenterline(vertices, { minimumLength: options.minimumLength ?? 0.02 });
    if (!centerline.valid) {
      rejected.push({ localId, reason: centerline.reason });
      continue;
    }

    const item = model.getItem(Number(localId));
    const globalId = unwrap(data._guid ?? data.GlobalId) || await item.getGuid() || '';
    const category = categoryOf(data) || await item.getCategory() || 'IFCELEMENT';
    segments.push({
      id: `${model.modelId}:${localId}`,
      modelId: model.modelId,
      localId: Number(localId),
      globalId,
      category,
      name: String(unwrap(data.Name) || ''),
      ...centerline,
    });
  }

  return { segments, rejected, candidateCount: candidateIds.length };
}

