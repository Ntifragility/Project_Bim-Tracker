#include "frag_io.hpp"
#include "ifc_compiler.hpp"
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

    // 1b. Streaming deflatePtrToFile roundtrip
    const fs::path streamTmp = fs::temp_directory_path() / "ifc2frag_stream_test.frag";
    int lastPct = 0;
    const uint64_t written = ifc2frag::deflatePtrToFile(
        raw.data(), raw.size(), streamTmp.string(), 1, [&](int pct) { lastPct = pct; });
    REQUIRE(written > 0);
    REQUIRE(lastPct == 100);
    const auto streamBytes = ifc2frag::readFileBytes(streamTmp.string());
    const auto streamStats = ifc2frag::inspectFragBytes(streamBytes);
    REQUIRE(streamStats.verified);
    REQUIRE(streamStats.maxLocalId == 101);
    fs::remove(streamTmp);
    std::cout << "[PASS] Synthetic FlatBuffer + streaming zlib roundtrip verified.\n";
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

#ifdef IFC2FRAG_HAS_WEBIFC
  // 3. Compile public/fixtures/survey-box.ifc -> temp .frag and verify FlatBuffer parity
  const fs::path sampleIfc = fs::path(PROJECT_ROOT_DIR) / "public/fixtures/survey-box.ifc";
  if (fs::exists(sampleIfc)) {
    const fs::path outFrag = fs::temp_directory_path() / "ifc2frag_survey_box_test.frag";
    ifc2frag::CompileOptions opts{};
    opts.inputPath = sampleIfc.string();
    opts.outputPath = outFrag.string();
    const auto res = ifc2frag::compileIfcToFrag(opts);
    REQUIRE(res.elementsProcessed >= 2);
    REQUIRE(res.uniqueShells >= 1);
    REQUIRE(res.compressedFragBytes > 100);
    const auto outBytes = ifc2frag::readFileBytes(outFrag.string());
    const auto outStats = ifc2frag::inspectFragBytes(outBytes);
    REQUIRE(outStats.verified);
    REQUIRE(outStats.globalTransformsCount == res.elementsProcessed);
    fs::remove(outFrag);
    std::cout << "[PASS] End-to-end C++ compile of survey-box.ifc verified: "
              << res.elementsProcessed << " elements, "
              << res.uniqueShells << " shells, "
              << res.propertySetsCount << " psets in " << res.elapsedSeconds << " s.\n";

    // 4. Test --fast, --threads 2, --no-props, and --only category filtering
    const fs::path outFragFast = fs::temp_directory_path() / "ifc2frag_survey_box_fast.frag";
    ifc2frag::CompileOptions fastOpts{};
    fastOpts.inputPath = sampleIfc.string();
    fastOpts.outputPath = outFragFast.string();
    fastOpts.zlibLevel = 1;
    fastOpts.threads = 2;
    fastOpts.includeProperties = false;
    fastOpts.onlyCategories = {"IFCWALLSTANDARDCASE", "IFCWALL", "IFCSLAB", "IFCBUILDINGELEMENTPROXY"};
    const auto fastRes = ifc2frag::compileIfcToFrag(fastOpts);
    REQUIRE(fastRes.propertySetsCount == 0);
    REQUIRE(fastRes.relationsCount == 0);
    const auto fastStats = ifc2frag::inspectFragBytes(ifc2frag::readFileBytes(outFragFast.string()));
    REQUIRE(fastStats.verified);
    fs::remove(outFragFast);
    std::cout << "[PASS] Fast/MT/--no-props/--only compile verified (" << fastRes.elementsProcessed << " elements).\n";
  }
#endif

  return 0;
}
