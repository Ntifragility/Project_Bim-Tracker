#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

namespace ifc2frag {

using ProgressCallback = std::function<void(int stage, int totalStages, const std::string& message)>;

class CompileCancelledError : public std::runtime_error {
 public:
  CompileCancelledError() : std::runtime_error("Compilation cancelled by user.") {}
};

enum class SplitMode {
  None = 0,
  ByStorey = 1,
  ByCategory = 2,
};

struct ChunkSummary {
  std::string id;
  std::string name;
  std::string file;
  double elevationM = 0.0;
  uint32_t elements = 0;
  uint32_t shells = 0;
  uint32_t samples = 0;
  uint64_t compressedBytes = 0;
  uint64_t uncompressedBytes = 0;
  float minX = 0.0f, minY = 0.0f, minZ = 0.0f;
  float maxX = 0.0f, maxY = 0.0f, maxZ = 0.0f;
};

struct CompileOptions {
  std::string inputPath;
  std::string outputPath;
  std::string outDir;
  SplitMode splitMode = SplitMode::None;
  bool coordinateToOrigin = true;
  bool rawShells = true;
  bool includeProperties = true;
  double distanceThresholdM = 100000.0;
  int zlibLevel = 6;
  int circleSegments = 12;
  uint32_t threads = 0;  // 0 = auto hardware_concurrency
  std::vector<std::string> excludeCategories;
  std::vector<std::string> onlyCategories;
  ProgressCallback onProgress;
  std::atomic<bool>* cancelRequested = nullptr;
};

struct CompileResult {
  uint32_t elementsProcessed = 0;
  uint32_t uniqueShells = 0;
  uint32_t samplesCount = 0;
  uint32_t propertySetsCount = 0;
  uint32_t relationsCount = 0;
  uint64_t rawFlatBufferBytes = 0;
  uint64_t compressedFragBytes = 0;
  double elapsedSeconds = 0.0;
  std::string manifestPath;
  std::vector<ChunkSummary> chunks;
};

CompileResult compileIfcToFrag(const CompileOptions& opts);

}  // namespace ifc2frag
