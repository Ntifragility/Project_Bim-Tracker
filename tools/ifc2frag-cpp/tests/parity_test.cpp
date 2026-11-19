#include "frag_io.hpp"
#include "fragments_generated.h"

#include <cstdlib>
#include <filesystem>
#include <iostream>

#define REQUIRE(cond)                                                          \
  do {                                                                         \
    if (!(cond)) {                                                             \
      std::cerr << "[FAIL] " << #cond << " at line " << __LINE__ << "\n";      \
      return 1;                                                                \
    }                                                                          \
  } while (0)

int main() {
  namespace fs = std::filesystem;

  // 1. Round-trip minimal synthetic Model FlatBuffer + zlib compression
  {
    flatbuffers::FlatBufferBuilder builder(1024);
    const auto guid = builder.CreateString("00000000-0000-4000-8000-000000000001");
    const auto meta = builder.CreateString("{\"schema\":\"IFC4\"}");
    const auto cat = builder.CreateString("IFCWALL");
    const auto cats = builder.CreateVector(&cat, 1);
    const uint32_t lid = 101;
    const auto lids = builder.CreateVector(&lid, 1);

    const Transform coords(DoubleVector(100.0, 200.0, 300.0), FloatVector(1, 0, 0), FloatVector(0, 1, 0));
    const auto meshes = CreateMeshes(builder, &coords);

    ModelBuilder mb(builder);
    mb.add_metadata(meta);
    mb.add_guid(guid);
    mb.add_max_local_id(101);
    mb.add_local_ids(lids);
    mb.add_categories(cats);
    mb.add_meshes(meshes);
    builder.Finish(mb.Finish());

    std::vector<uint8_t> raw(builder.GetBufferPointer(), builder.GetBufferPointer() + builder.GetSize());
    const auto compressed = ifc2frag::deflateZlib(raw);
    const auto stats = ifc2frag::inspectFragBytes(compressed);
    REQUIRE(stats.verified);
    REQUIRE(stats.maxLocalId == 101);
    REQUIRE(stats.localIdsCount == 1);
    REQUIRE(stats.categoriesCount == 1);
    REQUIRE(stats.coordX == 100.0 && stats.coordY == 200.0 && stats.coordZ == 300.0);
    std::cout << "[PASS] Synthetic FlatBuffer + zlib roundtrip verified.\n";
  }

  // 2. If .cache/frag/P22114-CC-3300-06-3D-001.frag exists, verify schema parity on real 147 MB model
  const fs::path realFrag = fs::path(PROJECT_ROOT_DIR) / ".cache/frag/P22114-CC-3300-06-3D-001.frag";
  if (fs::exists(realFrag)) {
    const auto bytes = ifc2frag::readFileBytes(realFrag.string());
    const auto stats = ifc2frag::inspectFragBytes(bytes);
    REQUIRE(stats.verified);
    REQUIRE(stats.globalTransformsCount > 10000);
    std::cout << "[PASS] Real P22114 .frag verified: "
              << stats.globalTransformsCount << " globalTransforms, "
              << stats.shellsCount << " shells.\n";
  } else {
    std::cout << "[SKIP] Real .cache/frag/P22114-CC-3300-06-3D-001.frag not found.\n";
  }

  return 0;
}
