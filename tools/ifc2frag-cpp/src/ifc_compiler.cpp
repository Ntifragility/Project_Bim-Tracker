#include "ifc_compiler.hpp"
#include "frag_io.hpp"
#include "fragments_generated.h"

#include <web-ifc/modelmanager/ModelManager.h>
#include <web-ifc/geometry/IfcGeometryProcessor.h>
#include <web-ifc/parsing/IfcLoader.h>
#include <web-ifc/schema/IfcSchemaManager.h>
#include <web-ifc/schema/ifc-schema.h>

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ifc2frag {

namespace {

constexpr size_t USHORT_MAX_POINTS = 65000;

struct DecomposedTransform {
  double px = 0, py = 0, pz = 0;
  float dxx = 1, dxy = 0, dxz = 0;
  float dyx = 0, dyy = 1, dyz = 0;
  double sx = 1, sy = 1, sz = 1;
  glm::dmat4 withoutScale{1.0};
};

double roundTo(double v, double precision) {
  return std::round(v * precision) / precision;
}

DecomposedTransform decomposeMatrix(const glm::dmat4& m) {
  DecomposedTransform out{};
  out.px = m[3][0];
  out.py = m[3][1];
  out.pz = m[3][2];

  glm::dvec3 col0(m[0][0], m[0][1], m[0][2]);
  glm::dvec3 col1(m[1][0], m[1][1], m[1][2]);
  glm::dvec3 col2(m[2][0], m[2][1], m[2][2]);

  double sx = glm::length(col0);
  double sy = glm::length(col1);
  double sz = glm::length(col2);
  if (sx < 1e-12) sx = 1.0;
  if (sy < 1e-12) sy = 1.0;
  if (sz < 1e-12) sz = 1.0;

  // Handle reflection if determinant < 0
  if (glm::determinant(glm::dmat3(col0, col1, col2)) < 0.0) {
    sx = -sx;
  }

  glm::dvec3 ux = col0 / sx;
  glm::dvec3 uy = col1 / sy;
  glm::dvec3 uz = col2 / sz;

  out.sx = sx;
  out.sy = sy;
  out.sz = sz;

  out.dxx = static_cast<float>(roundTo(ux.x, 1e3));
  out.dxy = static_cast<float>(roundTo(ux.y, 1e3));
  out.dxz = static_cast<float>(roundTo(ux.z, 1e3));
  out.dyx = static_cast<float>(roundTo(uy.x, 1e5));
  out.dyy = static_cast<float>(roundTo(uy.y, 1e5));
  out.dyz = static_cast<float>(roundTo(uy.z, 1e5));
  out.px = roundTo(out.px, 1e5);
  out.py = roundTo(out.py, 1e5);
  out.pz = roundTo(out.pz, 1e5);

  out.withoutScale = glm::dmat4(
      glm::dvec4(ux, 0.0),
      glm::dvec4(uy, 0.0),
      glm::dvec4(uz, 0.0),
      glm::dvec4(m[3][0], m[3][1], m[3][2], 1.0));
  return out;
}

Transform toFbTransform(const DecomposedTransform& dt) {
  return Transform(
      DoubleVector(dt.px, dt.py, dt.pz),
      FloatVector(dt.dxx, dt.dxy, dt.dxz),
      FloatVector(dt.dyx, dt.dyy, dt.dyz));
}

struct ShellData {
  std::vector<FloatVector> points;
  std::vector<std::array<uint32_t, 3>> triangles;
  float minX = 0, minY = 0, minZ = 0;
  float maxX = 0, maxY = 0, maxZ = 0;
  bool valid = false;
};

struct PointKey {
  float x, y, z;
  bool operator==(const PointKey& o) const {
    return x == o.x && y == o.y && z == o.z;
  }
};

struct PointKeyHash {
  size_t operator()(const PointKey& k) const {
    uint32_t hx, hy, hz;
    std::memcpy(&hx, &k.x, 4);
    std::memcpy(&hy, &k.y, 4);
    std::memcpy(&hz, &k.z, 4);
    size_t h = hx;
    h ^= hy + 0x9e3779b9 + (h << 6) + (h >> 2);
    h ^= hz + 0x9e3779b9 + (h << 6) + (h >> 2);
    return h;
  }
};

ShellData buildRawShell(
    const webifc::geometry::IfcGeometry& geom,
    double sx,
    double sy,
    double sz) {
  ShellData shell{};
  const auto& verts = geom.vertexData;
  const auto& indices = geom.indexData;
  if (verts.empty() || indices.size() < 3) {
    return shell;
  }

  const size_t stride = webifc::geometry::VERTEX_FORMAT_SIZE_FLOATS;
  const size_t vertCount = verts.size() / stride;

  std::unordered_map<PointKey, uint32_t, PointKeyHash> pointMap;
  pointMap.reserve(vertCount);
  shell.points.reserve(vertCount);
  shell.triangles.reserve(indices.size() / 3);

  float minX = std::numeric_limits<float>::infinity();
  float minY = std::numeric_limits<float>::infinity();
  float minZ = std::numeric_limits<float>::infinity();
  float maxX = -std::numeric_limits<float>::infinity();
  float maxY = -std::numeric_limits<float>::infinity();
  float maxZ = -std::numeric_limits<float>::infinity();

  auto getPointIdx = [&](uint32_t vIdx) -> uint32_t {
    const size_t base = static_cast<size_t>(vIdx) * stride;
    const float px = static_cast<float>(verts[base + 0] * sx);
    const float py = static_cast<float>(verts[base + 1] * sy);
    const float pz = static_cast<float>(verts[base + 2] * sz);
    minX = std::min(minX, px);
    minY = std::min(minY, py);
    minZ = std::min(minZ, pz);
    maxX = std::max(maxX, px);
    maxY = std::max(maxY, py);
    maxZ = std::max(maxZ, pz);
    PointKey key{px, py, pz};
    auto it = pointMap.find(key);
    if (it != pointMap.end()) return it->second;
    const uint32_t idx = static_cast<uint32_t>(shell.points.size());
    pointMap.emplace(key, idx);
    shell.points.emplace_back(px, py, pz);
    return idx;
  };

  for (size_t i = 0; i + 2 < indices.size(); i += 3) {
    const uint32_t a = indices[i + 0];
    const uint32_t b = indices[i + 1];
    const uint32_t c = indices[i + 2];
    if (a >= vertCount || b >= vertCount || c >= vertCount) continue;
    const uint32_t ia = getPointIdx(a);
    const uint32_t ib = getPointIdx(b);
    const uint32_t ic = getPointIdx(c);
    shell.triangles.push_back({ia, ib, ic});
  }

  if (shell.triangles.empty() || shell.points.empty() || !std::isfinite(minX)) {
    return shell;
  }
  if (minX == 0 && minY == 0 && minZ == 0 && maxX == 0 && maxY == 0 && maxZ == 0) {
    return shell;
  }

  shell.minX = minX;
  shell.minY = minY;
  shell.minZ = minZ;
  shell.maxX = maxX;
  shell.maxY = maxY;
  shell.maxZ = maxZ;
  shell.valid = true;
  return shell;
}

std::string makeUuidV4(uint64_t seed) {
  char buf[40];
  std::snprintf(
      buf,
      sizeof(buf),
      "c2f-%08x-0000-4000-8000-%012llx",
      static_cast<uint32_t>(seed & 0xFFFFFFFFu),
      static_cast<unsigned long long>(seed * 6364136223846793005ULL + 1442695040888963407ULL) & 0xFFFFFFFFFFFFULL);
  return std::string(buf);
}

std::string jsonEscape(std::string_view s) {
  std::string out;
  out.reserve(s.size() + 4);
  for (unsigned char c : s) {
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c < 0x20) out += ' ';
    else out += static_cast<char>(c);
  }
  return out;
}

}  // namespace

CompileResult compileIfcToFrag(const CompileOptions& opts) {
  const auto t0 = std::chrono::steady_clock::now();

  std::ifstream ifs(opts.inputPath, std::ios::binary);
  if (!ifs) {
    throw std::runtime_error("Cannot open input IFC file: " + opts.inputPath);
  }

  webifc::manager::ModelManager manager(false);
  manager.SetLogLevel(6);  // LOG_LEVEL_OFF

  webifc::manager::LoaderSettings settings{};
  settings.COORDINATE_TO_ORIGIN = opts.coordinateToOrigin;
  settings.CIRCLE_SEGMENTS = 12;
  const uint32_t modelID = manager.CreateModel(settings);
  auto* loader = manager.GetIfcLoader(modelID);
  if (!loader) {
    throw std::runtime_error("Failed to create web-ifc IfcLoader");
  }
  loader->LoadFile(ifs);

  auto* geomProc = manager.GetGeometryProcessor(modelID);
  const auto& schemaMgr = manager.GetSchemaManager();
  const uint32_t maxExpressId = loader->GetMaxExpressId();
  uint32_t nextSyntheticId = maxExpressId + 1;

  // Read coordination matrix
  bool coordsInitialized = false;
  Transform fbCoords(DoubleVector(0, 0, 0), FloatVector(1, 0, 0), FloatVector(0, 1, 0));

  // Buffers for Meshes
  std::vector<uint32_t> meshesItems;
  std::vector<Transform> globalTransforms;
  std::vector<uint32_t> globalTransformIds;

  std::vector<Transform> localTransforms;
  std::vector<uint32_t> localTransformIds;
  std::unordered_map<std::string, uint32_t> localTransformMap;
  // Identity local transform at index 0
  localTransforms.emplace_back(DoubleVector(0, 0, 0), FloatVector(1, 0, 0), FloatVector(0, 1, 0));
  localTransformIds.push_back(0);

  std::vector<Material> materials;
  std::vector<uint32_t> materialIds;
  std::unordered_map<uint32_t, uint32_t> materialKeyToId;

  std::vector<ShellData> shells;
  std::vector<Representation> representations;
  std::vector<uint32_t> representationIds;
  std::unordered_map<std::string, uint32_t> geomKeyToReprId;

  std::vector<Sample> samples;
  std::vector<uint32_t> sampleIds;

  // Metadata per item
  std::vector<uint32_t> localIds;
  std::vector<std::string> categories;
  std::vector<std::string> guids;
  std::vector<uint32_t> guidsItems;
  std::unordered_map<uint32_t, std::string> itemAttributes;
  std::unordered_map<uint32_t, uint32_t> expressIdToItemIndex;

  // Collect element types from schema (put IFCANNOTATION last just like @thatopen/fragments)
  const auto& elementTypesSet = schemaMgr.GetIfcElementList();
  std::vector<uint32_t> elementTypes(elementTypesSet.begin(), elementTypesSet.end());
  std::sort(elementTypes.begin(), elementTypes.end());
  const uint32_t annotationCode = schemaMgr.IfcTypeToTypeCode("IFCANNOTATION");
  const uint32_t spaceCode = schemaMgr.IfcTypeToTypeCode("IFCSPACE");

  auto itAnn = std::find(elementTypes.begin(), elementTypes.end(), annotationCode);
  if (itAnn != elementTypes.end()) {
    elementTypes.erase(itAnn);
    elementTypes.push_back(annotationCode);
  }

  for (const uint32_t typeCode : elementTypes) {
    const auto ids = loader->GetExpressIDsWithType(typeCode);
    if (ids.empty()) continue;
    const std::string catName = schemaMgr.IfcTypeCodeToType(typeCode);

    for (const uint32_t expressID : ids) {
      auto flatMesh = geomProc->GetFlatMesh(expressID);
      if (flatMesh.geometries.empty()) continue;

      if (!coordsInitialized) {
        const glm::dmat4 coordMat = geomProc->GetCoordinationMatrix();
        fbCoords = toFbTransform(decomposeMatrix(coordMat));
        coordsInitialized = true;
      }

      const glm::dmat4 firstMat = glm::make_mat4(flatMesh.geometries[0].flatTransformation.data());
      const DecomposedTransform elemDecomp = decomposeMatrix(firstMat);

      if (opts.distanceThresholdM > 0.0) {
        if (std::abs(elemDecomp.px) > opts.distanceThresholdM ||
            std::abs(elemDecomp.py) > opts.distanceThresholdM ||
            std::abs(elemDecomp.pz) > opts.distanceThresholdM) {
          continue;
        }
      }

      const glm::dmat4 invElemMat = glm::inverse(elemDecomp.withoutScale);
      struct PendingSample {
        uint32_t matIndex;
        uint32_t reprIndex;
        uint32_t ltIndex;
      };
      std::vector<PendingSample> pending;
      pending.reserve(flatMesh.geometries.size());

      for (const auto& placed : flatMesh.geometries) {
        const glm::dmat4 gMat = glm::make_mat4(placed.flatTransformation.data());
        const DecomposedTransform gDecomp = decomposeMatrix(gMat);

        // Scale-aware geometry key
        char keyBuf[96];
        std::snprintf(
            keyBuf,
            sizeof(keyBuf),
            "%u|%.4f|%.4f|%.4f",
            placed.geometryExpressID,
            gDecomp.sx,
            gDecomp.sy,
            gDecomp.sz);
        const std::string geomKey(keyBuf);

        uint32_t reprIndex = UINT32_MAX;
        auto git = geomKeyToReprId.find(geomKey);
        if (git != geomKeyToReprId.end()) {
          reprIndex = git->second;
          if (reprIndex == UINT32_MAX) continue;  // Previously skipped invalid/empty geometry
        } else {
          auto& rawGeom = geomProc->GetGeometry(placed.geometryExpressID);
          ShellData sh = buildRawShell(rawGeom, gDecomp.sx, gDecomp.sy, gDecomp.sz);
          if (!sh.valid) {
            geomKeyToReprId.emplace(geomKey, UINT32_MAX);
            continue;
          }
          reprIndex = static_cast<uint32_t>(representations.size());
          const uint32_t reprId = nextSyntheticId++;
          geomKeyToReprId.emplace(geomKey, reprIndex);
          representations.emplace_back(
              reprIndex,
              BoundingBox(FloatVector(sh.minX, sh.minY, sh.minZ), FloatVector(sh.maxX, sh.maxY, sh.maxZ)),
              RepresentationClass_SHELL);
          representationIds.push_back(reprId);
          shells.push_back(std::move(sh));
        }

        // Material deduplication (Sample stores 0-based index into meshes.materials)
        uint8_t mr = static_cast<uint8_t>(std::clamp(std::round(placed.color.r * 255.0), 0.0, 255.0));
        uint8_t mg = static_cast<uint8_t>(std::clamp(std::round(placed.color.g * 255.0), 0.0, 255.0));
        uint8_t mb = static_cast<uint8_t>(std::clamp(std::round(placed.color.b * 255.0), 0.0, 255.0));
        double alpha = placed.color.a;
        if (typeCode == spaceCode && alpha >= 0.99) {
          alpha = 0.5;
        }
        uint8_t ma = static_cast<uint8_t>(std::clamp(std::round(alpha * 255.0), 0.0, 255.0));
        const uint32_t matKey = (uint32_t(mr) << 24) | (uint32_t(mg) << 16) | (uint32_t(mb) << 8) | uint32_t(ma);
        uint32_t matIndex = 0;
        auto mit = materialKeyToId.find(matKey);
        if (mit != materialKeyToId.end()) {
          matIndex = mit->second;
        } else {
          matIndex = static_cast<uint32_t>(materials.size());
          materialKeyToId.emplace(matKey, matIndex);
          materials.emplace_back(mr, mg, mb, ma, RenderedFaces_ONE, Stroke_DEFAULT);
          materialIds.push_back(nextSyntheticId++);
        }

        // Local transform relative to element globalTransform (0 = identity at index 0)
        const glm::dmat4 relMat = invElemMat * gDecomp.withoutScale;
        const DecomposedTransform relDecomp = decomposeMatrix(relMat);
        const bool isIdentity =
            relDecomp.px == 0.0 && relDecomp.py == 0.0 && relDecomp.pz == 0.0 &&
            relDecomp.dxx == 1.0f && relDecomp.dxy == 0.0f && relDecomp.dxz == 0.0f &&
            relDecomp.dyx == 0.0f && relDecomp.dyy == 1.0f && relDecomp.dyz == 0.0f;

        uint32_t ltIndex = 0;
        if (!isIdentity) {
          char ltBuf[160];
          std::snprintf(
              ltBuf,
              sizeof(ltBuf),
              "%.4f|%.4f|%.4f|%.3f|%.3f|%.3f|%.4f|%.4f|%.4f",
              relDecomp.px, relDecomp.py, relDecomp.pz,
              relDecomp.dxx, relDecomp.dxy, relDecomp.dxz,
              relDecomp.dyx, relDecomp.dyy, relDecomp.dyz);
          auto lit = localTransformMap.find(ltBuf);
          if (lit != localTransformMap.end()) {
            ltIndex = lit->second;
          } else {
            ltIndex = static_cast<uint32_t>(localTransforms.size());
            localTransformMap.emplace(ltBuf, ltIndex);
            localTransforms.push_back(toFbTransform(relDecomp));
            localTransformIds.push_back(nextSyntheticId++);
          }
        }

        pending.push_back({matIndex, reprIndex, ltIndex});
      }

      if (pending.empty()) continue;

      const uint32_t itemIndex = static_cast<uint32_t>(localIds.size());
      expressIdToItemIndex.emplace(expressID, itemIndex);
      meshesItems.push_back(itemIndex);
      globalTransforms.push_back(toFbTransform(elemDecomp));
      globalTransformIds.push_back(nextSyntheticId++);

      localIds.push_back(expressID);
      categories.push_back(catName);

      // Extract GlobalId & Name from STEP line (arg 0 = GlobalId, arg 2 = Name)
      std::string guidStr;
      std::string nameStr;
      if (loader->IsValidExpressID(expressID)) {
        loader->MoveToLineArgument(expressID, 0);
        guidStr = loader->GetDecodedStringArgument();
        if (loader->GetNoLineArguments(expressID) > 2) {
          loader->MoveToLineArgument(expressID, 2);
          nameStr = loader->GetDecodedStringArgument();
        }
      }
      if (!guidStr.empty()) {
        guids.push_back(guidStr);
        guidsItems.push_back(itemIndex);
      }
      itemAttributes.emplace(expressID, nameStr);

      for (const auto& ps : pending) {
        const uint32_t sId = nextSyntheticId++;
        samples.emplace_back(itemIndex, ps.matIndex, ps.reprIndex, ps.ltIndex);
        sampleIds.push_back(sId);
      }
    }
  }

  // Build spatial structure tree (IfcProject -> IfcSite -> IfcBuilding -> IfcBuildingStorey -> elements)
  std::unordered_map<uint32_t, std::vector<uint32_t>> spatialChildren;
  const uint32_t relAggCode = schemaMgr.IfcTypeToTypeCode("IFCRELAGGREGATES");
  const uint32_t relContCode = schemaMgr.IfcTypeToTypeCode("IFCRELCONTAINEDINSPATIALSTRUCTURE");

  for (const uint32_t relId : loader->GetExpressIDsWithType(relAggCode)) {
    if (loader->GetNoLineArguments(relId) < 6) continue;
    loader->MoveToLineArgument(relId, 4);
    const uint32_t parentId = loader->GetOptionalRefArgument();
    loader->MoveToLineArgument(relId, 5);
    const auto children = loader->GetSetArgument();
    if (parentId != 0) {
      auto& vec = spatialChildren[parentId];
      vec.insert(vec.end(), children.begin(), children.end());
    }
  }
  for (const uint32_t relId : loader->GetExpressIDsWithType(relContCode)) {
    if (loader->GetNoLineArguments(relId) < 6) continue;
    loader->MoveToLineArgument(relId, 4);
    const auto elems = loader->GetSetArgument();
    loader->MoveToLineArgument(relId, 5);
    const uint32_t parentId = loader->GetOptionalRefArgument();
    if (parentId != 0) {
      auto& vec = spatialChildren[parentId];
      vec.insert(vec.end(), elems.begin(), elems.end());
    }
  }

  // Assemble FlatBuffers Model
  flatbuffers::FlatBufferBuilder builder(1024 * 1024);

  // Build Shells
  std::vector<flatbuffers::Offset<Shell>> shellOffsets;
  shellOffsets.reserve(shells.size());
  for (const auto& sh : shells) {
    const auto pointsOffset = builder.CreateVectorOfStructs(sh.points);
    const bool isBig = sh.points.size() > USHORT_MAX_POINTS;
    std::vector<uint16_t> faceIds(sh.triangles.size(), 0);
    const auto faceIdsOffset = builder.CreateVector(faceIds);

    if (isBig) {
      std::vector<flatbuffers::Offset<BigShellProfile>> bigProfiles;
      bigProfiles.reserve(sh.triangles.size());
      for (const auto& tri : sh.triangles) {
        const uint32_t arr[3] = {tri[0], tri[1], tri[2]};
        const auto idxOff = builder.CreateVector(arr, 3);
        bigProfiles.push_back(CreateBigShellProfile(builder, idxOff));
      }
      const auto emptyProf = builder.CreateVector(std::vector<flatbuffers::Offset<ShellProfile>>{});
      const auto emptyHole = builder.CreateVector(std::vector<flatbuffers::Offset<ShellHole>>{});
      const auto bigProfOff = builder.CreateVector(bigProfiles);
      const auto emptyBigHole = builder.CreateVector(std::vector<flatbuffers::Offset<BigShellHole>>{});
      shellOffsets.push_back(CreateShell(
          builder, emptyProf, emptyHole, pointsOffset, bigProfOff, emptyBigHole, ShellType_BIG, faceIdsOffset));
    } else {
      std::vector<flatbuffers::Offset<ShellProfile>> profiles;
      profiles.reserve(sh.triangles.size());
      for (const auto& tri : sh.triangles) {
        const uint16_t arr[3] = {
            static_cast<uint16_t>(tri[0]),
            static_cast<uint16_t>(tri[1]),
            static_cast<uint16_t>(tri[2])};
        const auto idxOff = builder.CreateVector(arr, 3);
        profiles.push_back(CreateShellProfile(builder, idxOff));
      }
      const auto profOff = builder.CreateVector(profiles);
      const auto emptyHole = builder.CreateVector(std::vector<flatbuffers::Offset<ShellHole>>{});
      const auto emptyBigProf = builder.CreateVector(std::vector<flatbuffers::Offset<BigShellProfile>>{});
      const auto emptyBigHole = builder.CreateVector(std::vector<flatbuffers::Offset<BigShellHole>>{});
      shellOffsets.push_back(CreateShell(
          builder, profOff, emptyHole, pointsOffset, emptyBigProf, emptyBigHole, ShellType_NONE, faceIdsOffset));
    }
  }

  const auto meshesItemsOff = builder.CreateVector(meshesItems);
  const auto samplesOff = builder.CreateVectorOfStructs(samples);
  const auto reprOff = builder.CreateVectorOfStructs(representations);
  const auto matOff = builder.CreateVectorOfStructs(materials);
  const auto emptyCircleExt = builder.CreateVector(std::vector<flatbuffers::Offset<CircleExtrusion>>{});
  const auto shellsOff = builder.CreateVector(shellOffsets);
  const auto ltOff = builder.CreateVectorOfStructs(localTransforms);
  const auto gtOff = builder.CreateVectorOfStructs(globalTransforms);
  const auto matIdsOff = builder.CreateVector(materialIds);
  const auto reprIdsOff = builder.CreateVector(representationIds);
  const auto sampleIdsOff = builder.CreateVector(sampleIds);
  const auto ltIdsOff = builder.CreateVector(localTransformIds);
  const auto gtIdsOff = builder.CreateVector(globalTransformIds);

  const auto meshesOff = CreateMeshes(
      builder,
      &fbCoords,
      meshesItemsOff,
      samplesOff,
      reprOff,
      matOff,
      emptyCircleExt,
      shellsOff,
      ltOff,
      gtOff,
      matIdsOff,
      reprIdsOff,
      sampleIdsOff,
      ltIdsOff,
      gtIdsOff);

  // Attributes (["Name","<val>","STRING"])
  std::vector<flatbuffers::Offset<Attribute>> attrOffsets;
  attrOffsets.reserve(localIds.size());
  for (const uint32_t eid : localIds) {
    const std::string& nm = itemAttributes[eid];
    if (nm.empty()) {
      const auto emptyVec = builder.CreateVector(std::vector<flatbuffers::Offset<flatbuffers::String>>{});
      attrOffsets.push_back(CreateAttribute(builder, emptyVec));
    } else {
      std::string entry = "[\"Name\",\"" + jsonEscape(nm) + "\",\"STRING\"]";
      auto sOff = builder.CreateString(entry);
      auto vecOff = builder.CreateVector(&sOff, 1);
      attrOffsets.push_back(CreateAttribute(builder, vecOff));
    }
  }

  // Spatial structure recursive builder
  std::unordered_set<uint32_t> visitedSpatial;
  auto buildSpatialNode = [&](auto& self, uint32_t eid) -> flatbuffers::Offset<SpatialStructure> {
    if (!visitedSpatial.insert(eid).second) {
      return 0;
    }
    const std::string cat = loader->IsValidExpressID(eid)
        ? schemaMgr.IfcTypeCodeToType(loader->GetLineType(eid))
        : "";
    std::vector<flatbuffers::Offset<SpatialStructure>> childOffsets;
    auto cit = spatialChildren.find(eid);
    if (cit != spatialChildren.end()) {
      for (const uint32_t cid : cit->second) {
        if (spatialChildren.count(cid) || expressIdToItemIndex.count(cid)) {
          auto childOff = self(self, cid);
          if (!childOff.IsNull()) childOffsets.push_back(childOff);
        }
      }
    }
    const auto catOff = cat.empty() ? 0 : builder.CreateString(cat);
    const auto childrenOff = builder.CreateVector(childOffsets);
    return CreateSpatialStructure(builder, eid, catOff, childrenOff);
  };

  flatbuffers::Offset<SpatialStructure> spatialRootOff = 0;
  const uint32_t projCode = schemaMgr.IfcTypeToTypeCode("IFCPROJECT");
  const auto projIds = loader->GetExpressIDsWithType(projCode);
  if (!projIds.empty()) {
    spatialRootOff = buildSpatialNode(buildSpatialNode, projIds[0]);
  }

  const auto metaOff = builder.CreateString("{\"schema\":\"IFC\",\"compiler\":\"ifc2frag-cpp\"}");
  const auto guidsOff = builder.CreateVectorOfStrings(guids);
  const auto guidsItemsOff = builder.CreateVector(guidsItems);
  const auto localIdsOff = builder.CreateVector(localIds);
  const auto catsOff = builder.CreateVectorOfStrings(categories);
  const auto attrsOff = builder.CreateVector(attrOffsets);
  const auto emptyRels = builder.CreateVector(std::vector<flatbuffers::Offset<Relation>>{});
  const auto emptyRelItems = builder.CreateVector(std::vector<int32_t>{});
  const auto modelGuidOff = builder.CreateString(makeUuidV4(maxExpressId));

  const auto modelOff = CreateModel(
      builder,
      metaOff,
      guidsOff,
      guidsItemsOff,
      nextSyntheticId,
      localIdsOff,
      catsOff,
      meshesOff,
      attrsOff,
      emptyRels,
      emptyRelItems,
      modelGuidOff,
      spatialRootOff);

  builder.Finish(modelOff);

  const uint8_t* ptr = builder.GetBufferPointer();
  const size_t rawSize = builder.GetSize();
  std::vector<uint8_t> rawBuf(ptr, ptr + rawSize);

  const auto compressed = deflateZlib(rawBuf, opts.zlibLevel);
  writeFileBytes(opts.outputPath, compressed);

  const auto t1 = std::chrono::steady_clock::now();
  const double elapsed = std::chrono::duration<double>(t1 - t0).count();

  CompileResult res{};
  res.elementsProcessed = static_cast<uint32_t>(localIds.size());
  res.uniqueShells = static_cast<uint32_t>(shells.size());
  res.samplesCount = static_cast<uint32_t>(samples.size());
  res.rawFlatBufferBytes = rawSize;
  res.compressedFragBytes = compressed.size();
  res.elapsedSeconds = elapsed;
  return res;
}

}  // namespace ifc2frag
