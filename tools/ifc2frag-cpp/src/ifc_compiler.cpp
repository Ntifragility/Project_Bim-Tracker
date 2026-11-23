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
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <thread>
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
  int64_t qx, qy, qz;
  bool operator==(const PointKey& o) const {
    return qx == o.qx && qy == o.qy && qz == o.qz;
  }
};

struct PointKeyHash {
  size_t operator()(const PointKey& k) const {
    size_t h = static_cast<size_t>(k.qx) * 73856093ULL;
    h ^= static_cast<size_t>(k.qy) * 19349663ULL;
    h ^= static_cast<size_t>(k.qz) * 83492791ULL;
    return h;
  }
};

struct RawShellJob {
  uint32_t shellSlot = 0;
  std::vector<double> verts;
  std::vector<uint32_t> indices;
  double sx = 1.0, sy = 1.0, sz = 1.0;
};

ShellData buildRawShellFromBuffers(
    const std::vector<double>& verts,
    const std::vector<uint32_t>& indices,
    double sx,
    double sy,
    double sz) {
  ShellData shell{};
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

  constexpr double WELD_GRID = 1e5;  // 1e-5 m (0.01 mm) vertex weld grid

  auto getPointIdx = [&](uint32_t vIdx) -> uint32_t {
    const size_t base = static_cast<size_t>(vIdx) * stride;
    const double dx = static_cast<double>(verts[base + 0]) * sx;
    const double dy = static_cast<double>(verts[base + 1]) * sy;
    const double dz = static_cast<double>(verts[base + 2]) * sz;
    const float px = static_cast<float>(dx);
    const float py = static_cast<float>(dy);
    const float pz = static_cast<float>(dz);
    minX = std::min(minX, px);
    minY = std::min(minY, py);
    minZ = std::min(minZ, pz);
    maxX = std::max(maxX, px);
    maxY = std::max(maxY, py);
    maxZ = std::max(maxZ, pz);
    PointKey key{
        static_cast<int64_t>(std::llround(dx * WELD_GRID)),
        static_cast<int64_t>(std::llround(dy * WELD_GRID)),
        static_cast<int64_t>(std::llround(dz * WELD_GRID))};
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
    if (ia == ib || ib == ic || ic == ia) continue;  // Drop degenerate welded triangles
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

std::string toUpperAscii(std::string_view s) {
  std::string out(s);
  for (char& c : out) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return out;
}

std::vector<uint32_t> readRefSet(const webifc::parsing::IfcLoader* loader) {
  std::vector<uint32_t> refs;
  if (!loader) return refs;
  const auto tt = loader->GetTokenType();
  loader->StepBack();
  if (tt != webifc::parsing::IfcTokenType::SET_BEGIN) return refs;
  const auto offsets = loader->GetSetArgument();
  refs.reserve(offsets.size());
  for (const uint32_t off : offsets) {
    if (loader->GetTokenType(off) == webifc::parsing::IfcTokenType::REF) {
      const uint32_t refId = loader->GetRefArgument(off);
      if (refId != 0) refs.push_back(refId);
    }
  }
  return refs;
}

std::pair<std::string, std::string> readNominalValue(const webifc::parsing::IfcLoader* loader, uint32_t propId) {
  using webifc::parsing::IfcTokenType;
  if (!loader || loader->GetNoLineArguments(propId) <= 2) return {};
  loader->MoveToLineArgument(propId, 2);
  const IfcTokenType tt = loader->GetTokenType();
  loader->StepBack();
  if (tt == IfcTokenType::EMPTY || tt == IfcTokenType::UNKNOWN) return {};

  std::string valType = "STRING";
  IfcTokenType inner = tt;
  if (tt == IfcTokenType::LABEL) {
    valType = std::string(loader->GetStringArgument());
    const IfcTokenType nextT = loader->GetTokenType();
    if (nextT != IfcTokenType::SET_BEGIN) return {};
    inner = loader->GetTokenType();
    loader->StepBack();
  }

  switch (inner) {
    case IfcTokenType::STRING:
      return {loader->GetDecodedStringArgument(), valType};
    case IfcTokenType::REAL:
      return {std::string(loader->GetDoubleArgumentAsString()), valType};
    case IfcTokenType::INTEGER:
      return {std::to_string(loader->GetIntArgument()), valType};
    case IfcTokenType::ENUM:
      return {std::string(loader->GetStringArgument()), valType};
    default:
      return {};
  }
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

std::string sanitizeChunkFilename(std::string_view name) {
  std::string out;
  out.reserve(name.size());
  for (unsigned char c : name) {
    if (std::isalnum(c) || c == '-' || c == '_') {
      out += static_cast<char>(c);
    } else if (c == ' ' || c == '.' || c == '/') {
      if (!out.empty() && out.back() != '_') out += '_';
    }
  }
  while (!out.empty() && out.back() == '_') out.pop_back();
  if (out.empty()) out = "Chunk";
  if (out.size() > 48) out.resize(48);
  return out;
}

std::string disciplineBucketForCategory(const std::string& upperCat) {
  if (upperCat.find("CABLE") != std::string::npos ||
      upperCat.find("ELECTRIC") != std::string::npos ||
      upperCat.find("LIGHT") != std::string::npos ||
      upperCat.find("JUNCTIONBOX") != std::string::npos ||
      upperCat.find("SWITCH") != std::string::npos ||
      upperCat.find("OUTLET") != std::string::npos ||
      upperCat.find("TRANSFORMER") != std::string::npos) {
    return "Electrical";
  }
  if (upperCat.find("DUCT") != std::string::npos ||
      upperCat.find("AIR") != std::string::npos ||
      upperCat.find("FAN") != std::string::npos ||
      upperCat.find("CHILLER") != std::string::npos ||
      upperCat.find("BOILER") != std::string::npos ||
      upperCat.find("COIL") != std::string::npos ||
      upperCat.find("DAMPER") != std::string::npos) {
    return "Mechanical";
  }
  if (upperCat.find("PIPE") != std::string::npos ||
      upperCat.find("PUMP") != std::string::npos ||
      upperCat.find("VALVE") != std::string::npos ||
      upperCat.find("SANITARY") != std::string::npos ||
      upperCat.find("FIRE") != std::string::npos ||
      upperCat.find("TANK") != std::string::npos) {
    return "Plumbing";
  }
  if (upperCat.find("BEAM") != std::string::npos ||
      upperCat.find("COLUMN") != std::string::npos ||
      upperCat.find("SLAB") != std::string::npos ||
      upperCat.find("FOOTING") != std::string::npos ||
      upperCat.find("PILE") != std::string::npos ||
      upperCat.find("MEMBER") != std::string::npos ||
      upperCat.find("PLATE") != std::string::npos ||
      upperCat.find("REINFORCING") != std::string::npos) {
    return "Structure";
  }
  if (upperCat.find("WALL") != std::string::npos ||
      upperCat.find("DOOR") != std::string::npos ||
      upperCat.find("WINDOW") != std::string::npos ||
      upperCat.find("ROOF") != std::string::npos ||
      upperCat.find("STAIR") != std::string::npos ||
      upperCat.find("RAILING") != std::string::npos ||
      upperCat.find("CURTAINWALL") != std::string::npos ||
      upperCat.find("COVERING") != std::string::npos) {
    return "Architecture";
  }
  return "Other";
}

// Fast zero-allocation quantized transform key (replaces snprintf + std::string hashing)
struct QuantizedTransformKey {
  int32_t v[9];
  bool operator==(const QuantizedTransformKey& o) const noexcept {
    for (int i = 0; i < 9; ++i) {
      if (v[i] != o.v[i]) return false;
    }
    return true;
  }
};

struct QuantizedTransformKeyHash {
  size_t operator()(const QuantizedTransformKey& k) const noexcept {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < 9; ++i) {
      h ^= static_cast<uint64_t>(static_cast<uint32_t>(k.v[i]));
      h *= 1099511628211ULL;
    }
    return static_cast<size_t>(h);
  }
};

inline QuantizedTransformKey makeTransformKey(const DecomposedTransform& d) noexcept {
  auto q4 = [](double x) -> int32_t {
    const double s = std::round(x * 10000.0);
    return static_cast<int32_t>(std::clamp(s, -2.0e9, 2.0e9));
  };
  auto q3 = [](float x) -> int32_t {
    return static_cast<int32_t>(std::round(static_cast<double>(x) * 1000.0));
  };
  return QuantizedTransformKey{{
      q4(d.px), q4(d.py), q4(d.pz),
      q3(d.dxx), q3(d.dxy), q3(d.dxz),
      q4(d.dyx), q4(d.dyy), q4(d.dyz),
  }};
}

}  // namespace

CompileResult compileIfcToFrag(const CompileOptions& opts) {
  const auto t0 = std::chrono::steady_clock::now();
  const auto checkCancelled = [&]() {
    if (opts.cancelRequested && opts.cancelRequested->load(std::memory_order_relaxed)) {
      throw CompileCancelledError();
    }
  };
  std::mutex progressMtx;
  const auto report = [&](int stage, const std::string& msg) {
    if (opts.onProgress) {
      std::lock_guard<std::mutex> lk(progressMtx);
      opts.onProgress(stage, 5, msg);
    }
  };
  const uint32_t hwThreads = std::thread::hardware_concurrency();
  std::error_code fsEc;
  const uint64_t inputFileBytes = std::filesystem::file_size(opts.inputPath, fsEc);
  const bool isLargeIfc = !fsEc && inputFileBytes > (250ULL * 1024ULL * 1024ULL);
  // Resolve AutoBundle: <50 MB IFC -> 1-chunk .fragbundle; >=50 MB IFC -> Spatial .fragbundle
  SplitMode effectiveSplitMode = opts.splitMode;
  if (effectiveSplitMode == SplitMode::AutoBundle) {
    constexpr uint64_t SMALL_BUNDLE_THRESHOLD = 50ULL * 1024ULL * 1024ULL;
    effectiveSplitMode = (!fsEc && inputFileBytes < SMALL_BUNDLE_THRESHOLD)
        ? SplitMode::SingleBundle
        : SplitMode::Spatial;
  }
  // Low-RAM multi-threaded welding: up to 4 threads with compact 16-shell batches on >250 MB IFCs
  const uint32_t defaultThreads = std::min<uint32_t>(4u, hwThreads > 0 ? hwThreads : 1u);
  const uint32_t workerCount = opts.threads > 0 ? opts.threads : defaultThreads;
  const size_t shellBatchSize = isLargeIfc ? 16u : 64u;
  const bool extractProps = opts.includeProperties && (!isLargeIfc || opts.forceProperties);

  checkCancelled();

  std::ifstream ifs(opts.inputPath, std::ios::binary);
  if (!ifs) {
    throw std::runtime_error("Cannot open input IFC file: " + opts.inputPath);
  }

  webifc::manager::ModelManager manager(false);
  manager.SetLogLevel(6);  // LOG_LEVEL_OFF

  webifc::manager::LoaderSettings settings{};
  settings.COORDINATE_TO_ORIGIN = opts.coordinateToOrigin;
  settings.CIRCLE_SEGMENTS = static_cast<uint16_t>(std::clamp(opts.circleSegments, 4, 32));
  settings.TAPE_SIZE = 134217728;       // 128 MB STEP token tape
  settings.MEMORY_LIMIT = 0xFFFFFFFFu;  // 4 GB tape limit on 64-bit host
  const uint32_t modelID = manager.CreateModel(settings);
  auto* loader = manager.GetIfcLoader(modelID);
  if (!loader) {
    throw std::runtime_error("Failed to create web-ifc IfcLoader");
  }
  report(1, "Parsing IFC STEP file...");
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
  std::unordered_map<QuantizedTransformKey, uint32_t, QuantizedTransformKeyHash> localTransformMap;
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

  std::unordered_set<std::string> excludeSet;
  for (const auto& c : opts.excludeCategories) excludeSet.insert(toUpperAscii(c));
  if (opts.skipFasteners) {
    excludeSet.insert("IFCFASTENER");
    excludeSet.insert("IFCMECHANICALFASTENER");
  }
  std::unordered_set<std::string> onlySet;
  for (const auto& c : opts.onlyCategories) onlySet.insert(toUpperAscii(c));

  size_t totalCandidates = 0;
  std::vector<std::pair<uint32_t, std::vector<uint32_t>>> typedIds;
  typedIds.reserve(elementTypes.size());
  for (const uint32_t typeCode : elementTypes) {
    const std::string upperCat = toUpperAscii(schemaMgr.IfcTypeCodeToType(typeCode));
    if (!excludeSet.empty() && excludeSet.count(upperCat)) continue;
    if (!onlySet.empty() && !onlySet.count(upperCat)) continue;
    auto ids = loader->GetExpressIDsWithType(typeCode);
    if (!ids.empty()) {
      totalCandidates += ids.size();
      typedIds.emplace_back(typeCode, std::move(ids));
    }
  }
  report(2, "Extracting geometry (0%, " + std::to_string(totalCandidates) + " entities, " +
                std::to_string(workerCount) + " threads)...");
  size_t processedCandidates = 0;
  auto lastProgressAt = std::chrono::steady_clock::now();

  std::vector<RawShellJob> shellJobs;
  shellJobs.reserve(shellBatchSize);

  auto flushShellBatch = [&]() {
    if (shellJobs.empty()) return;
    const size_t n = shellJobs.size();
    const uint32_t nThreads = std::min<uint32_t>(workerCount, static_cast<uint32_t>(n));
    if (nThreads <= 1) {
      for (size_t i = 0; i < n; ++i) {
        const auto& job = shellJobs[i];
        ShellData sh = buildRawShellFromBuffers(job.verts, job.indices, job.sx, job.sy, job.sz);
        if (sh.valid) {
          representations[job.shellSlot] = Representation(
              job.shellSlot,
              BoundingBox(FloatVector(sh.minX, sh.minY, sh.minZ), FloatVector(sh.maxX, sh.maxY, sh.maxZ)),
              RepresentationClass_SHELL);
        }
        shells[job.shellSlot] = std::move(sh);
      }
    } else {
      std::atomic<size_t> nextIdx{0};
      std::vector<std::thread> pool;
      pool.reserve(nThreads);
      for (uint32_t t = 0; t < nThreads; ++t) {
        pool.emplace_back([&]() {
          while (true) {
            const size_t i = nextIdx.fetch_add(1, std::memory_order_relaxed);
            if (i >= n) break;
            const auto& job = shellJobs[i];
            ShellData sh = buildRawShellFromBuffers(job.verts, job.indices, job.sx, job.sy, job.sz);
            if (sh.valid) {
              representations[job.shellSlot] = Representation(
                  job.shellSlot,
                  BoundingBox(FloatVector(sh.minX, sh.minY, sh.minZ), FloatVector(sh.maxX, sh.maxY, sh.maxZ)),
                  RepresentationClass_SHELL);
            }
            shells[job.shellSlot] = std::move(sh);
          }
        });
      }
      for (auto& th : pool) th.join();
    }
    shellJobs.clear();
  };

  for (const auto& [typeCode, ids] : typedIds) {
    const std::string catName = schemaMgr.IfcTypeCodeToType(typeCode);

    for (const uint32_t expressID : ids) {
      ++processedCandidates;
      if ((processedCandidates & 255u) == 0u) {
        checkCancelled();
        const auto now = std::chrono::steady_clock::now();
        if (now - lastProgressAt >= std::chrono::milliseconds(1000)) {
          const int pct = totalCandidates > 0
              ? static_cast<int>((processedCandidates * 100u) / totalCandidates)
              : 0;
          report(2, "Extracting geometry (" + std::to_string(pct) + "%, " +
                        std::to_string(localIds.size()) + " meshes, " +
                        std::to_string(shells.size()) + " shells)...");
          lastProgressAt = now;
        }
      }
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
          if (rawGeom.vertexData.empty() || rawGeom.indexData.size() < 3) {
            geomKeyToReprId.emplace(geomKey, UINT32_MAX);
            continue;
          }
          reprIndex = static_cast<uint32_t>(representations.size());
          const uint32_t reprId = nextSyntheticId++;
          geomKeyToReprId.emplace(geomKey, reprIndex);
          representations.emplace_back(
              reprIndex,
              BoundingBox(FloatVector(0, 0, 0), FloatVector(0, 0, 0)),
              RepresentationClass_SHELL);
          representationIds.push_back(reprId);
          shells.emplace_back();

          if (workerCount <= 1) {
            ShellData sh = buildRawShellFromBuffers(rawGeom.vertexData, rawGeom.indexData, gDecomp.sx, gDecomp.sy, gDecomp.sz);
            if (sh.valid) {
              representations[reprIndex] = Representation(
                  reprIndex,
                  BoundingBox(FloatVector(sh.minX, sh.minY, sh.minZ), FloatVector(sh.maxX, sh.maxY, sh.maxZ)),
                  RepresentationClass_SHELL);
            }
            shells[reprIndex] = std::move(sh);
          } else {
            RawShellJob job{};
            job.shellSlot = reprIndex;
            job.verts = rawGeom.vertexData;
            job.indices = rawGeom.indexData;
            job.sx = gDecomp.sx;
            job.sy = gDecomp.sy;
            job.sz = gDecomp.sz;
            shellJobs.push_back(std::move(job));
            if (shellJobs.size() >= shellBatchSize) {
              flushShellBatch();
            }
          }
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
          const QuantizedTransformKey ltKey = makeTransformKey(relDecomp);
          auto lit = localTransformMap.find(ltKey);
          if (lit != localTransformMap.end()) {
            ltIndex = lit->second;
          } else {
            ltIndex = static_cast<uint32_t>(localTransforms.size());
            localTransformMap.emplace(ltKey, ltIndex);
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
  flushShellBatch();
  checkCancelled();

  // Filter out any samples referencing degenerate shells that became invalid after welding
  if (!samples.empty()) {
    std::vector<Sample> validSamples;
    std::vector<uint32_t> validSampleIds;
    validSamples.reserve(samples.size());
    validSampleIds.reserve(sampleIds.size());
    for (size_t i = 0; i < samples.size(); ++i) {
      const uint32_t rIdx = samples[i].representation();
      if (rIdx < shells.size() && shells[rIdx].valid) {
        validSamples.push_back(samples[i]);
        validSampleIds.push_back(sampleIds[i]);
      }
    }
    samples.swap(validSamples);
    sampleIds.swap(validSampleIds);
  }

  const uint32_t geomElementsCount = static_cast<uint32_t>(localIds.size());
  report(2, "Extracted " + std::to_string(geomElementsCount) + " meshes (" +
                std::to_string(shells.size()) + " unique shells, " +
                std::to_string(samples.size()) + " samples)");

  report(3, "Building spatial hierarchy, properties & releasing IFC memory...");
  // Build spatial structure tree (IfcProject -> IfcSite -> IfcBuilding -> IfcBuildingStorey -> elements)
  std::unordered_map<uint32_t, std::vector<uint32_t>> spatialChildren;
  const uint32_t relAggCode = schemaMgr.IfcTypeToTypeCode("IFCRELAGGREGATES");
  const uint32_t relContCode = schemaMgr.IfcTypeToTypeCode("IFCRELCONTAINEDINSPATIALSTRUCTURE");

  for (const uint32_t relId : loader->GetExpressIDsWithType(relAggCode)) {
    if (loader->GetNoLineArguments(relId) < 6) continue;
    loader->MoveToLineArgument(relId, 4);
    const uint32_t parentId = loader->GetOptionalRefArgument();
    loader->MoveToLineArgument(relId, 5);
    const auto children = readRefSet(loader);
    if (parentId != 0) {
      auto& vec = spatialChildren[parentId];
      vec.insert(vec.end(), children.begin(), children.end());
    }
  }
  for (const uint32_t relId : loader->GetExpressIDsWithType(relContCode)) {
    if (loader->GetNoLineArguments(relId) < 6) continue;
    loader->MoveToLineArgument(relId, 4);
    const auto elems = readRefSet(loader);
    loader->MoveToLineArgument(relId, 5);
    const uint32_t parentId = loader->GetOptionalRefArgument();
    if (parentId != 0) {
      auto& vec = spatialChildren[parentId];
      vec.insert(vec.end(), elems.begin(), elems.end());
    }
  }

  // Pre-capture spatial node categories before closing web-ifc model to free 1-2+ GB RAM
  std::unordered_map<uint32_t, std::string> spatialCats;
  for (const auto& [pid, children] : spatialChildren) {
    if (loader->IsValidExpressID(pid)) {
      spatialCats.emplace(pid, schemaMgr.IfcTypeCodeToType(loader->GetLineType(pid)));
    }
    for (const uint32_t cid : children) {
      if (!spatialCats.count(cid) && loader->IsValidExpressID(cid)) {
        spatialCats.emplace(cid, schemaMgr.IfcTypeCodeToType(loader->GetLineType(cid)));
      }
    }
  }
  const uint32_t projCode = schemaMgr.IfcTypeToTypeCode("IFCPROJECT");
  const auto projIds = loader->GetExpressIDsWithType(projCode);
  if (!projIds.empty() && loader->IsValidExpressID(projIds[0])) {
    spatialCats.emplace(projIds[0], schemaMgr.IfcTypeCodeToType(loader->GetLineType(projIds[0])));
  }

  // Extract IFC Property Sets & Relations (Option 2A + 2C) before closing web-ifc
  std::unordered_map<uint32_t, std::vector<std::string>> extraAttrEntries;
  std::map<uint32_t, std::map<std::string, std::vector<uint32_t>>> relationsMap;
  uint32_t propertySetsCount = 0;

  if (extractProps) {
    checkCancelled();
    const uint32_t relDefPropsCode = schemaMgr.IfcTypeToTypeCode("IFCRELDEFINESBYPROPERTIES");
    const uint32_t relDefTypeCode = schemaMgr.IfcTypeToTypeCode("IFCRELDEFINESBYTYPE");
    const uint32_t psetCode = schemaMgr.IfcTypeToTypeCode("IFCPROPERTYSET");
    const uint32_t singleValCode = schemaMgr.IfcTypeToTypeCode("IFCPROPERTYSINGLEVALUE");

    std::unordered_set<uint32_t> registeredPsets;
    std::unordered_set<uint32_t> registeredProps;

    auto registerPropertySet = [&](uint32_t psetId) -> bool {
      if (psetId == 0 || !loader->IsValidExpressID(psetId)) return false;
      if (loader->GetLineType(psetId) != psetCode) return false;
      if (!registeredPsets.insert(psetId).second) return true;

      std::string psetName;
      if (loader->GetNoLineArguments(psetId) > 2) {
        loader->MoveToLineArgument(psetId, 2);
        psetName = loader->GetDecodedStringArgument();
      }
      if (!expressIdToItemIndex.count(psetId)) {
        const uint32_t idx = static_cast<uint32_t>(localIds.size());
        expressIdToItemIndex.emplace(psetId, idx);
        localIds.push_back(psetId);
        categories.push_back("IFCPROPERTYSET");
      }
      if (!psetName.empty()) {
        extraAttrEntries[psetId].push_back("[\"Name\",\"" + jsonEscape(psetName) + "\",\"IFCLABEL\"]");
      }

      if (loader->GetNoLineArguments(psetId) > 4) {
        loader->MoveToLineArgument(psetId, 4);
        const auto propIds = readRefSet(loader);
        std::vector<uint32_t> validPropIds;
        validPropIds.reserve(propIds.size());
        for (const uint32_t pid : propIds) {
          if (pid == 0 || !loader->IsValidExpressID(pid)) continue;
          if (loader->GetLineType(pid) != singleValCode) continue;
          validPropIds.push_back(pid);
          if (registeredProps.insert(pid).second) {
            std::string propName;
            if (loader->GetNoLineArguments(pid) > 0) {
              loader->MoveToLineArgument(pid, 0);
              propName = loader->GetDecodedStringArgument();
            }
            const auto [nomVal, nomType] = readNominalValue(loader, pid);
            if (!expressIdToItemIndex.count(pid)) {
              const uint32_t pidx = static_cast<uint32_t>(localIds.size());
              expressIdToItemIndex.emplace(pid, pidx);
              localIds.push_back(pid);
              categories.push_back("IFCPROPERTYSINGLEVALUE");
            }
            auto& entries = extraAttrEntries[pid];
            if (!propName.empty()) {
              entries.push_back("[\"Name\",\"" + jsonEscape(propName) + "\",\"IFCLABEL\"]");
            }
            if (!nomVal.empty()) {
              entries.push_back("[\"NominalValue\",\"" + jsonEscape(nomVal) + "\",\"" + jsonEscape(nomType) + "\"]");
            }
          }
        }
        if (!validPropIds.empty()) {
          relationsMap[psetId]["HasProperties"] = std::move(validPropIds);
        }
      }
      ++propertySetsCount;
      return true;
    };

    // Direct element -> PropertySet links
    for (const uint32_t relId : loader->GetExpressIDsWithType(relDefPropsCode)) {
      if (loader->GetNoLineArguments(relId) < 6) continue;
      loader->MoveToLineArgument(relId, 5);
      const uint32_t psetId = loader->GetOptionalRefArgument();
      if (psetId == 0 || !loader->IsValidExpressID(psetId) || loader->GetLineType(psetId) != psetCode) continue;
      loader->MoveToLineArgument(relId, 4);
      const auto relatedObjs = readRefSet(loader);
      bool anyMatched = false;
      for (const uint32_t eid : relatedObjs) {
        auto it = expressIdToItemIndex.find(eid);
        if (it != expressIdToItemIndex.end() && it->second < geomElementsCount) {
          anyMatched = true;
          break;
        }
      }
      if (!anyMatched) continue;
      if (!registerPropertySet(psetId)) continue;
      for (const uint32_t eid : relatedObjs) {
        auto it = expressIdToItemIndex.find(eid);
        if (it != expressIdToItemIndex.end() && it->second < geomElementsCount) {
          relationsMap[eid]["IsDefinedBy"].push_back(psetId);
        }
      }
    }

    // Type-inherited PropertySet links (IfcRelDefinesByType -> IfcTypeObject.HasPropertySets)
    for (const uint32_t relId : loader->GetExpressIDsWithType(relDefTypeCode)) {
      if (loader->GetNoLineArguments(relId) < 6) continue;
      loader->MoveToLineArgument(relId, 5);
      const uint32_t typeId = loader->GetOptionalRefArgument();
      if (typeId == 0 || !loader->IsValidExpressID(typeId) || loader->GetNoLineArguments(typeId) <= 5) continue;
      loader->MoveToLineArgument(typeId, 5);
      const auto typePsets = readRefSet(loader);
      if (typePsets.empty()) continue;
      loader->MoveToLineArgument(relId, 4);
      const auto relatedObjs = readRefSet(loader);
      std::vector<uint32_t> matchedObjs;
      for (const uint32_t eid : relatedObjs) {
        auto it = expressIdToItemIndex.find(eid);
        if (it != expressIdToItemIndex.end() && it->second < geomElementsCount) {
          matchedObjs.push_back(eid);
        }
      }
      if (matchedObjs.empty()) continue;
      for (const uint32_t psetId : typePsets) {
        if (!registerPropertySet(psetId)) continue;
        for (const uint32_t eid : matchedObjs) {
          relationsMap[eid]["IsDefinedBy"].push_back(psetId);
        }
      }
    }
  }

  // Pre-capture storey metadata if splitting by storey (before closing web-ifc)
  struct StoreyMeta {
    uint32_t id = 0;
    std::string name;
    double elevationM = 0.0;
  };
  std::unordered_map<uint32_t, StoreyMeta> storeyMetaMap;
  if (opts.splitMode == SplitMode::ByStorey) {
    const uint32_t storeyCode = schemaMgr.IfcTypeToTypeCode("IFCBUILDINGSTOREY");
    for (const uint32_t sid : loader->GetExpressIDsWithType(storeyCode)) {
      if (!loader->IsValidExpressID(sid)) continue;
      StoreyMeta sm{};
      sm.id = sid;
      if (loader->GetNoLineArguments(sid) > 2) {
        loader->MoveToLineArgument(sid, 2);
        sm.name = loader->GetDecodedStringArgument();
      }
      if (sm.name.empty()) sm.name = "Storey_" + std::to_string(sid);
      if (loader->GetNoLineArguments(sid) > 9) {
        loader->MoveToLineArgument(sid, 9);
        const auto tt = loader->GetTokenType();
        loader->StepBack();
        if (tt == webifc::parsing::IfcTokenType::REAL) {
          sm.elevationM = loader->GetDoubleArgument();
        }
      }
      storeyMetaMap.emplace(sid, std::move(sm));
    }
  }

  // Release all web-ifc STEP tape & geometry caches BEFORE FlatBuffer allocation!
  geomProc->Clear();
  manager.CloseAllModels();
  ifs.close();
  checkCancelled();

  // ───────────────────────────────────────────────────────────────────────────
  // SVF2-Lite Chunked Bundle Writer (SingleBundle / Spatial / Storey / Category)
  // ───────────────────────────────────────────────────────────────────────────
  if (effectiveSplitMode != SplitMode::None) {
    namespace fs = std::filesystem;
    fs::path bundleDir = opts.outDir.empty()
        ? (fs::path(opts.inputPath).parent_path() / (fs::path(opts.inputPath).stem().string() + ".fragbundle"))
        : fs::path(opts.outDir);
    fs::create_directories(bundleDir);

    struct ChunkBucket {
      std::string id;
      std::string name;
      double elevationM = 0.0;
      std::vector<uint32_t> itemIndices;  // indices in [0, geomElementsCount)
    };
    std::map<std::string, ChunkBucket> bucketMap;

    // Index samples by itemIndex for O(1) slicing per chunk (needed by Spatial mode & per-chunk packing)
    std::vector<std::vector<size_t>> samplesByItem(geomElementsCount);
    for (size_t si = 0; si < samples.size(); ++si) {
      const uint32_t ii = samples[si].item();
      if (ii < geomElementsCount) samplesByItem[ii].push_back(si);
    }

    if (effectiveSplitMode == SplitMode::SingleBundle) {
      ChunkBucket singleBucket{};
      singleBucket.id = "principal";
      singleBucket.name = fs::path(opts.inputPath).stem().string();
      singleBucket.elevationM = 0.0;
      singleBucket.itemIndices.reserve(geomElementsCount);
      for (uint32_t itemIdx = 0; itemIdx < geomElementsCount; ++itemIdx) {
        singleBucket.itemIndices.push_back(itemIdx);
      }
      bucketMap.emplace("00_model", std::move(singleBucket));
    } else if (effectiveSplitMode == SplitMode::Spatial) {
      // Tier 0: Principal Elements (largest ~12% of triangles across entire model)
      // Tier 1: Remaining detail elements partitioned into balanced X-Z spatial zones
      struct ElemMetric {
        uint32_t itemIdx;
        float extent;
        uint64_t tris;
        double gx, gz;
      };
      std::vector<ElemMetric> metrics;
      metrics.reserve(geomElementsCount);
      uint64_t totalTris = 0;
      for (uint32_t itemIdx = 0; itemIdx < geomElementsCount; ++itemIdx) {
        float maxExt = 0.0f;
        uint64_t tris = 0;
        for (const size_t si : samplesByItem[itemIdx]) {
          const auto& sh = shells[samples[si].representation()];
          const float dx = sh.maxX - sh.minX;
          const float dy = sh.maxY - sh.minY;
          const float dz = sh.maxZ - sh.minZ;
          const float diag = std::sqrt(dx * dx + dy * dy + dz * dz);
          if (diag > maxExt) maxExt = diag;
          tris += sh.triangles.size();
        }
        const auto& gt = globalTransforms[itemIdx];
        metrics.push_back({itemIdx, maxExt, tris, gt.position().x(), gt.position().z()});
        totalTris += tris;
      }

      std::sort(metrics.begin(), metrics.end(), [](const ElemMetric& a, const ElemMetric& b) {
        return a.extent > b.extent;
      });

      const uint64_t principalTriBudget = std::max<uint64_t>(1, totalTris / 8u);  // ~12.5% of triangles
      const size_t maxPrincipalElems = std::max<size_t>(1, geomElementsCount / 5u);  // cap at 20% of elements
      uint64_t principalTris = 0;

      ChunkBucket principalBucket{};
      principalBucket.id = "principal";
      principalBucket.name = "Principal Structure";
      principalBucket.elevationM = -1e9;

      std::vector<ElemMetric> detailMetrics;
      detailMetrics.reserve(geomElementsCount);

      for (const auto& m : metrics) {
        if (principalBucket.itemIndices.empty() ||
            (principalTris < principalTriBudget && principalBucket.itemIndices.size() < maxPrincipalElems)) {
          principalBucket.itemIndices.push_back(m.itemIdx);
          principalTris += m.tris;
        } else {
          detailMetrics.push_back(m);
        }
      }
      bucketMap.emplace("00_principal", std::move(principalBucket));

      if (!detailMetrics.empty()) {
        double minX = std::numeric_limits<double>::infinity();
        double maxX = -std::numeric_limits<double>::infinity();
        double minZ = std::numeric_limits<double>::infinity();
        double maxZ = -std::numeric_limits<double>::infinity();
        for (const auto& m : detailMetrics) {
          minX = std::min(minX, m.gx);
          maxX = std::max(maxX, m.gx);
          minZ = std::min(minZ, m.gz);
          maxZ = std::max(maxZ, m.gz);
        }
        const double spanX = std::max(1e-3, maxX - minX);
        const double spanZ = std::max(1e-3, maxZ - minZ);

        // Pick grid dimensions targeting ~8-12 zones on large models, 1x1 on tiny fixtures
        int nx = 1, nz = 1;
        if (detailMetrics.size() >= 1000) {
          const double aspect = spanX / spanZ;
          if (aspect >= 1.5) { nx = 4; nz = 2; }
          else if (aspect <= 0.67) { nx = 2; nz = 4; }
          else { nx = 3; nz = 3; }
          if (detailMetrics.size() >= 25000) {
            nx = aspect >= 1.2 ? 4 : 3;
            nz = aspect <= 0.8 ? 4 : 3;
          }
        } else if (detailMetrics.size() >= 100) {
          nx = 2; nz = 2;
        }

        for (const auto& m : detailMetrics) {
          int ix = static_cast<int>(((m.gx - minX) / spanX) * nx);
          int iz = static_cast<int>(((m.gz - minZ) / spanZ) * nz);
          ix = std::clamp(ix, 0, nx - 1);
          iz = std::clamp(iz, 0, nz - 1);
          const char rowChar = static_cast<char>('A' + iz);
          const std::string zoneLabel = std::string("Zone ") + rowChar + std::to_string(ix + 1);
          const std::string key = std::string("zone-") + rowChar + std::to_string(ix + 1);
          auto& b = bucketMap[key];
          if (b.id.empty()) {
            b.id = key;
            b.name = zoneLabel;
            b.elevationM = static_cast<double>(iz * nx + ix + 1);
          }
          b.itemIndices.push_back(m.itemIdx);
        }
      }
    } else if (effectiveSplitMode == SplitMode::ByStorey) {
      std::unordered_map<uint32_t, uint32_t> parentOf;
      for (const auto& [pid, children] : spatialChildren) {
        for (const uint32_t cid : children) {
          if (!parentOf.count(cid)) parentOf.emplace(cid, pid);
        }
      }
      for (uint32_t itemIdx = 0; itemIdx < geomElementsCount; ++itemIdx) {
        const uint32_t eid = localIds[itemIdx];
        uint32_t cur = eid;
        uint32_t foundStorey = 0;
        for (int depth = 0; depth < 16; ++depth) {
          if (storeyMetaMap.count(cur)) {
            foundStorey = cur;
            break;
          }
          auto pit = parentOf.find(cur);
          if (pit == parentOf.end() || pit->second == cur) break;
          cur = pit->second;
        }
        if (foundStorey != 0) {
          const auto& sm = storeyMetaMap[foundStorey];
          const std::string key = "storey-" + std::to_string(foundStorey);
          auto& b = bucketMap[key];
          if (b.id.empty()) {
            b.id = key;
            b.name = sm.name;
            b.elevationM = sm.elevationM;
          }
          b.itemIndices.push_back(itemIdx);
        } else {
          auto& b = bucketMap["unassigned"];
          if (b.id.empty()) {
            b.id = "unassigned";
            b.name = "Unassigned";
            b.elevationM = 1e9;
          }
          b.itemIndices.push_back(itemIdx);
        }
      }
    } else {
      for (uint32_t itemIdx = 0; itemIdx < geomElementsCount; ++itemIdx) {
        const std::string disc = disciplineBucketForCategory(toUpperAscii(categories[itemIdx]));
        const std::string key = "disc-" + toUpperAscii(disc);
        auto& b = bucketMap[key];
        if (b.id.empty()) {
          b.id = key;
          b.name = disc;
          b.elevationM = 0.0;
        }
        b.itemIndices.push_back(itemIdx);
      }
    }

    std::vector<ChunkBucket> orderedBuckets;
    orderedBuckets.reserve(bucketMap.size());
    for (auto& [k, b] : bucketMap) {
      if (!b.itemIndices.empty()) orderedBuckets.push_back(std::move(b));
    }
    std::sort(orderedBuckets.begin(), orderedBuckets.end(), [](const ChunkBucket& a, const ChunkBucket& b) {
      if (a.elevationM != b.elevationM) return a.elevationM < b.elevationM;
      return a.name < b.name;
    });

    std::unordered_map<uint32_t, std::string> guidByItem;
    for (size_t gi = 0; gi < guidsItems.size() && gi < guids.size(); ++gi) {
      guidByItem.emplace(guidsItems[gi], guids[gi]);
    }

    CompileResult res{};
    res.elementsProcessed = geomElementsCount;
    res.uniqueShells = static_cast<uint32_t>(shells.size());
    res.samplesCount = static_cast<uint32_t>(samples.size());
    res.propertySetsCount = propertySetsCount;

    // Parallel Stage 4 chunk packing & zlib compression (bounded to max 3 threads for low peak RAM)
    const size_t totalChunks = orderedBuckets.size();
    const size_t chunkThreads = std::min<size_t>(
        3u, std::min<size_t>(totalChunks, std::max<size_t>(1u, static_cast<size_t>(workerCount))));
    std::vector<ChunkSummary> chunkResults(totalChunks);
    std::vector<uint32_t> chunkRelCounts(totalChunks, 0);
    std::atomic<size_t> nextChunkIdx{0};
    std::atomic<size_t> completedChunks{0};
    std::mutex errMtx;
    std::exception_ptr firstErr = nullptr;

    auto packOneChunk = [&](size_t ci) {
      checkCancelled();
      const auto& bucket = orderedBuckets[ci];
      char prefix[8];
      std::snprintf(prefix, sizeof(prefix), "%02zu_", ci);
      const std::string chunkFile = std::string(prefix) + sanitizeChunkFilename(bucket.name) + ".frag";
      const fs::path chunkPath = bundleDir / chunkFile;

      report(4, "Packing chunk [" + std::to_string(ci + 1) + "/" + std::to_string(totalChunks) + "] " +
                    bucket.name + " (" + std::to_string(bucket.itemIndices.size()) + " elements, " +
                    std::to_string(chunkThreads) + " threads)...");

      // Remap chunk-local mesh arrays
      std::vector<uint32_t> cMeshesItems;
      std::vector<Transform> cGlobalTransforms;
      std::vector<uint32_t> cGlobalTransformIds;
      std::vector<Transform> cLocalTransforms;
      std::vector<uint32_t> cLocalTransformIds;
      std::unordered_map<uint32_t, uint32_t> ltRemap;
      cLocalTransforms.push_back(localTransforms[0]);
      cLocalTransformIds.push_back(localTransformIds[0]);
      ltRemap.emplace(0, 0);

      std::vector<Material> cMaterials;
      std::vector<uint32_t> cMaterialIds;
      std::unordered_map<uint32_t, uint32_t> matRemap;

      std::vector<uint32_t> cShellOrigIndices;
      std::vector<Representation> cReprs;
      std::vector<uint32_t> cReprIds;
      std::unordered_map<uint32_t, uint32_t> reprRemap;

      std::vector<Sample> cSamples;
      std::vector<uint32_t> cSampleIds;

      std::vector<uint32_t> cLocalIds;
      std::vector<std::string> cCategories;
      std::vector<std::string> cGuids;
      std::vector<uint32_t> cGuidsItems;

      float cMinX = std::numeric_limits<float>::infinity();
      float cMinY = std::numeric_limits<float>::infinity();
      float cMinZ = std::numeric_limits<float>::infinity();
      float cMaxX = -std::numeric_limits<float>::infinity();
      float cMaxY = -std::numeric_limits<float>::infinity();
      float cMaxZ = -std::numeric_limits<float>::infinity();

      std::unordered_set<uint32_t> cOwnerIds;
      for (const uint32_t origItemIdx : bucket.itemIndices) {
        const uint32_t newItemIdx = static_cast<uint32_t>(cLocalIds.size());
        const uint32_t eid = localIds[origItemIdx];
        cOwnerIds.insert(eid);

        cMeshesItems.push_back(newItemIdx);
        cGlobalTransforms.push_back(globalTransforms[origItemIdx]);
        cGlobalTransformIds.push_back(globalTransformIds[origItemIdx]);
        cLocalIds.push_back(eid);
        cCategories.push_back(categories[origItemIdx]);
        auto git = guidByItem.find(origItemIdx);
        if (git != guidByItem.end()) {
          cGuids.push_back(git->second);
          cGuidsItems.push_back(newItemIdx);
        }

        const auto& gt = globalTransforms[origItemIdx];
        const float gx = static_cast<float>(gt.position().x());
        const float gy = static_cast<float>(gt.position().y());
        const float gz = static_cast<float>(gt.position().z());

        for (const size_t si : samplesByItem[origItemIdx]) {
          const Sample& s = samples[si];
          // Remap material
          uint32_t newMat = 0;
          auto mit = matRemap.find(s.material());
          if (mit != matRemap.end()) {
            newMat = mit->second;
          } else {
            newMat = static_cast<uint32_t>(cMaterials.size());
            matRemap.emplace(s.material(), newMat);
            cMaterials.push_back(materials[s.material()]);
            cMaterialIds.push_back(materialIds[s.material()]);
          }
          // Remap representation & shell
          uint32_t newRepr = 0;
          auto rit = reprRemap.find(s.representation());
          if (rit != reprRemap.end()) {
            newRepr = rit->second;
          } else {
            newRepr = static_cast<uint32_t>(cReprs.size());
            reprRemap.emplace(s.representation(), newRepr);
            const auto& origR = representations[s.representation()];
            cReprs.emplace_back(newRepr, origR.bbox(), origR.representation_class());
            cReprIds.push_back(representationIds[s.representation()]);
            cShellOrigIndices.push_back(s.representation());
          }
          // Remap local transform
          uint32_t newLt = 0;
          auto lit = ltRemap.find(s.local_transform());
          if (lit != ltRemap.end()) {
            newLt = lit->second;
          } else {
            newLt = static_cast<uint32_t>(cLocalTransforms.size());
            ltRemap.emplace(s.local_transform(), newLt);
            cLocalTransforms.push_back(localTransforms[s.local_transform()]);
            cLocalTransformIds.push_back(localTransformIds[s.local_transform()]);
          }

          cSamples.emplace_back(newItemIdx, newMat, newRepr, newLt);
          cSampleIds.push_back(sampleIds[si]);

          const auto& sh = shells[s.representation()];
          const float ext = std::max({
              std::abs(sh.maxX - sh.minX),
              std::abs(sh.maxY - sh.minY),
              std::abs(sh.maxZ - sh.minZ)}) * 0.5f;
          cMinX = std::min(cMinX, gx - ext);
          cMinY = std::min(cMinY, gy - ext);
          cMinZ = std::min(cMinZ, gz - ext);
          cMaxX = std::max(cMaxX, gx + ext);
          cMaxY = std::max(cMaxY, gy + ext);
          cMaxZ = std::max(cMaxZ, gz + ext);
        }
      }

      // Include Pset & PropertySingleValue items referenced by this chunk's elements
      std::map<uint32_t, std::map<std::string, std::vector<uint32_t>>> cRelsMap;
      std::unordered_set<uint32_t> addedPsets;
      std::unordered_set<uint32_t> addedProps;
      for (const uint32_t eid : cOwnerIds) {
        auto relIt = relationsMap.find(eid);
        if (relIt == relationsMap.end()) continue;
        cRelsMap[eid] = relIt->second;
        auto psetIt = relIt->second.find("IsDefinedBy");
        if (psetIt == relIt->second.end()) continue;
        for (const uint32_t psetId : psetIt->second) {
          if (addedPsets.insert(psetId).second) {
            cLocalIds.push_back(psetId);
            cCategories.push_back("IFCPROPERTYSET");
            auto pRelIt = relationsMap.find(psetId);
            if (pRelIt != relationsMap.end()) {
              cRelsMap[psetId] = pRelIt->second;
              auto hpIt = pRelIt->second.find("HasProperties");
              if (hpIt != pRelIt->second.end()) {
                for (const uint32_t pid : hpIt->second) {
                  if (addedProps.insert(pid).second) {
                    cLocalIds.push_back(pid);
                    cCategories.push_back("IFCPROPERTYSINGLEVALUE");
                  }
                }
              }
            }
          }
        }
      }

      // Pre-size chunk FlatBufferBuilder
      size_t cEst = 512 * 1024;
      for (const uint32_t origShellIdx : cShellOrigIndices) {
        const auto& sh = shells[origShellIdx];
        cEst += sh.points.size() * 16u + sh.triangles.size() * 28u + 64u;
      }
      cEst += cSamples.size() * 32u + cLocalIds.size() * 64u + cRelsMap.size() * 64u;
      cEst += cEst / 6u;
      constexpr size_t MAX_CHUNK_PRESIZE = 64ULL * 1024ULL * 1024ULL;
      if (cEst > MAX_CHUNK_PRESIZE) cEst = MAX_CHUNK_PRESIZE;

      flatbuffers::FlatBufferBuilder cBuilder(cEst);
      std::vector<flatbuffers::Offset<Shell>> cShellOffsets;
      cShellOffsets.reserve(cShellOrigIndices.size());
      for (const uint32_t origShellIdx : cShellOrigIndices) {
        const auto& sh = shells[origShellIdx];
        const auto pointsOffset = cBuilder.CreateVectorOfStructs(sh.points);
        const bool isBig = sh.points.size() > USHORT_MAX_POINTS;
        std::vector<uint16_t> faceIds(sh.triangles.size(), 0);
        const auto faceIdsOffset = cBuilder.CreateVector(faceIds);
        if (isBig) {
          std::vector<flatbuffers::Offset<BigShellProfile>> bigProfiles;
          bigProfiles.reserve(sh.triangles.size());
          for (const auto& tri : sh.triangles) {
            const uint32_t arr[3] = {tri[0], tri[1], tri[2]};
            bigProfiles.push_back(CreateBigShellProfile(cBuilder, cBuilder.CreateVector(arr, 3)));
          }
          cShellOffsets.push_back(CreateShell(
              cBuilder,
              cBuilder.CreateVector(std::vector<flatbuffers::Offset<ShellProfile>>{}),
              cBuilder.CreateVector(std::vector<flatbuffers::Offset<ShellHole>>{}),
              pointsOffset,
              cBuilder.CreateVector(bigProfiles),
              cBuilder.CreateVector(std::vector<flatbuffers::Offset<BigShellHole>>{}),
              ShellType_BIG,
              faceIdsOffset));
        } else {
          std::vector<flatbuffers::Offset<ShellProfile>> profiles;
          profiles.reserve(sh.triangles.size());
          for (const auto& tri : sh.triangles) {
            const uint16_t arr[3] = {
                static_cast<uint16_t>(tri[0]),
                static_cast<uint16_t>(tri[1]),
                static_cast<uint16_t>(tri[2])};
            profiles.push_back(CreateShellProfile(cBuilder, cBuilder.CreateVector(arr, 3)));
          }
          cShellOffsets.push_back(CreateShell(
              cBuilder,
              cBuilder.CreateVector(profiles),
              cBuilder.CreateVector(std::vector<flatbuffers::Offset<ShellHole>>{}),
              pointsOffset,
              cBuilder.CreateVector(std::vector<flatbuffers::Offset<BigShellProfile>>{}),
              cBuilder.CreateVector(std::vector<flatbuffers::Offset<BigShellHole>>{}),
              ShellType_NONE,
              faceIdsOffset));
        }
      }

      const auto cMeshesOff = CreateMeshes(
          cBuilder,
          &fbCoords,
          cBuilder.CreateVector(cMeshesItems),
          cBuilder.CreateVectorOfStructs(cSamples),
          cBuilder.CreateVectorOfStructs(cReprs),
          cBuilder.CreateVectorOfStructs(cMaterials),
          cBuilder.CreateVector(std::vector<flatbuffers::Offset<CircleExtrusion>>{}),
          cBuilder.CreateVector(cShellOffsets),
          cBuilder.CreateVectorOfStructs(cLocalTransforms),
          cBuilder.CreateVectorOfStructs(cGlobalTransforms),
          cBuilder.CreateVector(cMaterialIds),
          cBuilder.CreateVector(cReprIds),
          cBuilder.CreateVector(cSampleIds),
          cBuilder.CreateVector(cLocalTransformIds),
          cBuilder.CreateVector(cGlobalTransformIds));

      std::vector<flatbuffers::Offset<Attribute>> cAttrOffsets;
      cAttrOffsets.reserve(cLocalIds.size());
      for (const uint32_t eid : cLocalIds) {
        auto extraIt = extraAttrEntries.find(eid);
        if (extraIt != extraAttrEntries.end() && !extraIt->second.empty()) {
          std::vector<flatbuffers::Offset<flatbuffers::String>> strOffs;
          strOffs.reserve(extraIt->second.size());
          for (const auto& entry : extraIt->second) strOffs.push_back(cBuilder.CreateString(entry));
          cAttrOffsets.push_back(CreateAttribute(cBuilder, cBuilder.CreateVector(strOffs)));
          continue;
        }
        auto nmIt = itemAttributes.find(eid);
        if (nmIt == itemAttributes.end() || nmIt->second.empty()) {
          cAttrOffsets.push_back(CreateAttribute(
              cBuilder, cBuilder.CreateVector(std::vector<flatbuffers::Offset<flatbuffers::String>>{})));
        } else {
          auto sOff = cBuilder.CreateString("[\"Name\",\"" + jsonEscape(nmIt->second) + "\",\"STRING\"]");
          cAttrOffsets.push_back(CreateAttribute(cBuilder, cBuilder.CreateVector(&sOff, 1)));
        }
      }

      std::vector<flatbuffers::Offset<Relation>> cRelOffsets;
      std::vector<int32_t> cRelItems;
      for (const auto& [ownerId, relByName] : cRelsMap) {
        std::vector<flatbuffers::Offset<flatbuffers::String>> dataOffs;
        for (const auto& [relName, targets] : relByName) {
          if (targets.empty()) continue;
          std::string json = "[\"" + jsonEscape(relName) + "\"";
          for (const uint32_t tid : targets) json += "," + std::to_string(tid);
          json += "]";
          dataOffs.push_back(cBuilder.CreateString(json));
        }
        if (!dataOffs.empty()) {
          cRelItems.push_back(static_cast<int32_t>(ownerId));
          cRelOffsets.push_back(CreateRelation(cBuilder, cBuilder.CreateVector(dataOffs)));
        }
      }

      const auto cModelOff = CreateModel(
          cBuilder,
          cBuilder.CreateString("{\"schema\":\"IFC\",\"compiler\":\"ifc2frag-cpp\",\"chunk\":\"" + jsonEscape(bucket.name) + "\"}"),
          cBuilder.CreateVectorOfStrings(cGuids),
          cBuilder.CreateVector(cGuidsItems),
          nextSyntheticId,
          cBuilder.CreateVector(cLocalIds),
          cBuilder.CreateVectorOfStrings(cCategories),
          cMeshesOff,
          cBuilder.CreateVector(cAttrOffsets),
          cBuilder.CreateVector(cRelOffsets),
          cBuilder.CreateVector(cRelItems),
          cBuilder.CreateString(makeUuidV4(maxExpressId + ci + 1)),
          0);
      cBuilder.Finish(cModelOff);

      const uint8_t* cPtr = cBuilder.GetBufferPointer();
      const size_t cRawSize = cBuilder.GetSize();
      const uint64_t cCompBytes = deflatePtrToFile(cPtr, cRawSize, chunkPath.string(), opts.zlibLevel);
      cBuilder.Clear();

      ChunkSummary cs{};
      cs.id = bucket.id;
      cs.name = bucket.name;
      cs.file = chunkFile;
      cs.elevationM = bucket.elevationM == 1e9 ? 0.0 : bucket.elevationM;
      cs.elements = static_cast<uint32_t>(bucket.itemIndices.size());
      cs.shells = static_cast<uint32_t>(cShellOrigIndices.size());
      cs.samples = static_cast<uint32_t>(cSamples.size());
      cs.compressedBytes = cCompBytes;
      cs.uncompressedBytes = cRawSize;
      if (std::isfinite(cMinX)) {
        cs.minX = cMinX; cs.minY = cMinY; cs.minZ = cMinZ;
        cs.maxX = cMaxX; cs.maxY = cMaxY; cs.maxZ = cMaxZ;
      }
      chunkRelCounts[ci] = static_cast<uint32_t>(cRelOffsets.size());
      chunkResults[ci] = std::move(cs);
      ++completedChunks;
    };

    if (chunkThreads <= 1) {
      for (size_t ci = 0; ci < totalChunks; ++ci) {
        packOneChunk(ci);
      }
    } else {
      std::vector<std::thread> chunkPool;
      chunkPool.reserve(chunkThreads);
      for (size_t t = 0; t < chunkThreads; ++t) {
        chunkPool.emplace_back([&]() {
          while (true) {
            {
              std::lock_guard<std::mutex> lk(errMtx);
              if (firstErr) break;
            }
            const size_t ci = nextChunkIdx.fetch_add(1, std::memory_order_relaxed);
            if (ci >= totalChunks) break;
            try {
              packOneChunk(ci);
            } catch (...) {
              std::lock_guard<std::mutex> lk(errMtx);
              if (!firstErr) firstErr = std::current_exception();
              break;
            }
          }
        });
      }
      for (auto& th : chunkPool) th.join();
      if (firstErr) std::rethrow_exception(firstErr);
    }

    for (size_t ci = 0; ci < totalChunks; ++ci) {
      res.rawFlatBufferBytes += chunkResults[ci].uncompressedBytes;
      res.compressedFragBytes += chunkResults[ci].compressedBytes;
      res.relationsCount += chunkRelCounts[ci];
      res.chunks.push_back(std::move(chunkResults[ci]));
    }

    // Write manifest.json
    const fs::path manifestPath = bundleDir / "manifest.json";
    std::ofstream mfs(manifestPath, std::ios::binary | std::ios::trunc);
    if (!mfs) throw std::runtime_error("Cannot write manifest.json: " + manifestPath.string());
    mfs << std::fixed << std::setprecision(4);
    const char* splitModeStr =
        effectiveSplitMode == SplitMode::SingleBundle
            ? "single"
            : (effectiveSplitMode == SplitMode::Spatial
                   ? "spatial"
                   : (effectiveSplitMode == SplitMode::ByStorey ? "storey" : "category"));
    mfs << "{\n"
        << "  \"version\": 1,\n"
        << "  \"format\": \"fragbundle\",\n"
        << "  \"sourceName\": \"" << jsonEscape(fs::path(opts.inputPath).filename().string()) << "\",\n"
        << "  \"splitMode\": \"" << splitModeStr << "\",\n"
        << "  \"circleSegments\": " << opts.circleSegments << ",\n"
        << "  \"coordinationMatrix\": {\n"
        << "    \"position\": [" << fbCoords.position().x() << ", " << fbCoords.position().y() << ", " << fbCoords.position().z() << "],\n"
        << "    \"xDirection\": [" << fbCoords.x_direction().x() << ", " << fbCoords.x_direction().y() << ", " << fbCoords.x_direction().z() << "],\n"
        << "    \"yDirection\": [" << fbCoords.y_direction().x() << ", " << fbCoords.y_direction().y() << ", " << fbCoords.y_direction().z() << "]\n"
        << "  },\n"
        << "  \"totalElements\": " << res.elementsProcessed << ",\n"
        << "  \"totalCompressedBytes\": " << res.compressedFragBytes << ",\n"
        << "  \"totalUncompressedBytes\": " << res.rawFlatBufferBytes << ",\n"
        << "  \"chunks\": [\n";
    for (size_t i = 0; i < res.chunks.size(); ++i) {
      const auto& ch = res.chunks[i];
      mfs << "    {\n"
          << "      \"id\": \"" << jsonEscape(ch.id) << "\",\n"
          << "      \"name\": \"" << jsonEscape(ch.name) << "\",\n"
          << "      \"file\": \"" << jsonEscape(ch.file) << "\",\n"
          << "      \"elevationM\": " << ch.elevationM << ",\n"
          << "      \"elements\": " << ch.elements << ",\n"
          << "      \"shells\": " << ch.shells << ",\n"
          << "      \"samples\": " << ch.samples << ",\n"
          << "      \"compressedBytes\": " << ch.compressedBytes << ",\n"
          << "      \"uncompressedBytes\": " << ch.uncompressedBytes << ",\n"
          << "      \"bbox\": { \"min\": [" << ch.minX << ", " << ch.minY << ", " << ch.minZ << "], \"max\": [" << ch.maxX << ", " << ch.maxY << ", " << ch.maxZ << "] }\n"
          << "    }" << (i + 1 < res.chunks.size() ? "," : "") << "\n";
    }
    mfs << "  ]\n}\n";
    mfs.close();

    res.manifestPath = manifestPath.string();
    const auto t1 = std::chrono::steady_clock::now();
    res.elapsedSeconds = std::chrono::duration<double>(t1 - t0).count();
    report(5, "Wrote " + std::to_string(res.chunks.size()) + " chunks + manifest.json");
    return res;
  }

  // Pre-size FlatBufferBuilder to avoid 2x doubling spikes during serialization
  size_t estimatedBytes = 1024 * 1024;
  for (const auto& sh : shells) {
    estimatedBytes += sh.points.size() * 16u + sh.triangles.size() * 28u + 64u;
  }
  estimatedBytes += samples.size() * 32u + localIds.size() * 64u + relationsMap.size() * 64u;
  estimatedBytes = estimatedBytes + (estimatedBytes / 6u);  // +~16% headroom
  constexpr size_t MAX_PRESIZE = 128ULL * 1024ULL * 1024ULL;
  if (estimatedBytes > MAX_PRESIZE) estimatedBytes = MAX_PRESIZE;

  // Assemble FlatBuffers Model
  report(4, "Packing FlatBuffers model (" + std::to_string(shells.size()) + " shells, " +
                std::to_string(samples.size()) + " samples, " +
                std::to_string(propertySetsCount) + " psets)...");
  flatbuffers::FlatBufferBuilder builder(estimatedBytes);

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

  // Capture counts before releasing mesh vectors
  const uint32_t uniqueShellsCount = static_cast<uint32_t>(shells.size());
  const uint32_t samplesCountVal = static_cast<uint32_t>(samples.size());

  // Release mesh vectors now that they are serialized into FlatBuffers
  {
    std::vector<ShellData>().swap(shells);
    std::vector<Sample>().swap(samples);
    std::vector<Representation>().swap(representations);
    std::vector<Transform>().swap(globalTransforms);
    std::vector<Transform>().swap(localTransforms);
    std::vector<Material>().swap(materials);
  }

  // Attributes (elements + IFCPROPERTYSET + IFCPROPERTYSINGLEVALUE)
  std::vector<flatbuffers::Offset<Attribute>> attrOffsets;
  attrOffsets.reserve(localIds.size());
  for (const uint32_t eid : localIds) {
    auto extraIt = extraAttrEntries.find(eid);
    if (extraIt != extraAttrEntries.end() && !extraIt->second.empty()) {
      std::vector<flatbuffers::Offset<flatbuffers::String>> strOffs;
      strOffs.reserve(extraIt->second.size());
      for (const auto& entry : extraIt->second) {
        strOffs.push_back(builder.CreateString(entry));
      }
      attrOffsets.push_back(CreateAttribute(builder, builder.CreateVector(strOffs)));
      continue;
    }
    auto nmIt = itemAttributes.find(eid);
    if (nmIt == itemAttributes.end() || nmIt->second.empty()) {
      const auto emptyVec = builder.CreateVector(std::vector<flatbuffers::Offset<flatbuffers::String>>{});
      attrOffsets.push_back(CreateAttribute(builder, emptyVec));
    } else {
      std::string entry = "[\"Name\",\"" + jsonEscape(nmIt->second) + "\",\"STRING\"]";
      auto sOff = builder.CreateString(entry);
      auto vecOff = builder.CreateVector(&sOff, 1);
      attrOffsets.push_back(CreateAttribute(builder, vecOff));
    }
  }

  // Relations (owner localId -> ["IsDefinedBy", pset1, ...] / ["HasProperties", prop1, ...])
  std::vector<flatbuffers::Offset<Relation>> relOffsets;
  std::vector<int32_t> relItems;
  relOffsets.reserve(relationsMap.size());
  relItems.reserve(relationsMap.size());
  for (const auto& [ownerId, relByName] : relationsMap) {
    std::vector<flatbuffers::Offset<flatbuffers::String>> dataOffs;
    dataOffs.reserve(relByName.size());
    for (const auto& [relName, targets] : relByName) {
      if (targets.empty()) continue;
      std::string json = "[\"" + jsonEscape(relName) + "\"";
      for (const uint32_t tid : targets) {
        json += "," + std::to_string(tid);
      }
      json += "]";
      dataOffs.push_back(builder.CreateString(json));
    }
    if (!dataOffs.empty()) {
      relItems.push_back(static_cast<int32_t>(ownerId));
      relOffsets.push_back(CreateRelation(builder, builder.CreateVector(dataOffs)));
    }
  }
  const uint32_t relationsCountVal = static_cast<uint32_t>(relOffsets.size());

  // Spatial structure recursive builder (uses pre-captured spatialCats; web-ifc is already closed)
  std::unordered_set<uint32_t> visitedSpatial;
  auto buildSpatialNode = [&](auto& self, uint32_t eid) -> flatbuffers::Offset<SpatialStructure> {
    if (!visitedSpatial.insert(eid).second) {
      return 0;
    }
    auto catIt = spatialCats.find(eid);
    const std::string cat = catIt != spatialCats.end() ? catIt->second : "";
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
  if (!projIds.empty()) {
    spatialRootOff = buildSpatialNode(buildSpatialNode, projIds[0]);
  }

  const auto metaOff = builder.CreateString("{\"schema\":\"IFC\",\"compiler\":\"ifc2frag-cpp\"}");
  const auto guidsOff = builder.CreateVectorOfStrings(guids);
  const auto guidsItemsOff = builder.CreateVector(guidsItems);
  const auto localIdsOff = builder.CreateVector(localIds);
  const auto catsOff = builder.CreateVectorOfStrings(categories);
  const auto attrsOff = builder.CreateVector(attrOffsets);
  const auto relsOff = builder.CreateVector(relOffsets);
  const auto relItemsOff = builder.CreateVector(relItems);
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
      relsOff,
      relItemsOff,
      modelGuidOff,
      spatialRootOff);

  builder.Finish(modelOff);
  checkCancelled();

  const uint8_t* ptr = builder.GetBufferPointer();
  const size_t rawSize = builder.GetSize();
  const size_t rawMb = (rawSize + (1024 * 1024 - 1)) / (1024 * 1024);
  report(5, "Compressing zlib level " + std::to_string(opts.zlibLevel) + " (" +
                std::to_string(rawMb) + " MB) & writing .frag...");
  const uint64_t compressedBytes = deflatePtrToFile(
      ptr,
      rawSize,
      opts.outputPath,
      opts.zlibLevel,
      [&](int pct) {
        checkCancelled();
        report(5, "Compressing zlib level " + std::to_string(opts.zlibLevel) + " (" +
                      std::to_string(pct) + "%)...");
      });
  builder.Clear();

  const auto t1 = std::chrono::steady_clock::now();
  const double elapsed = std::chrono::duration<double>(t1 - t0).count();

  CompileResult res{};
  res.elementsProcessed = geomElementsCount;
  res.uniqueShells = uniqueShellsCount;
  res.samplesCount = samplesCountVal;
  res.propertySetsCount = propertySetsCount;
  res.relationsCount = relationsCountVal;
  res.rawFlatBufferBytes = rawSize;
  res.compressedFragBytes = compressedBytes;
  res.elapsedSeconds = elapsed;
  return res;
}

}  // namespace ifc2frag
