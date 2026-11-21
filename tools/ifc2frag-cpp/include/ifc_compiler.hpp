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

struct CompileOptions {
  std::string inputPath;
  std::string outputPath;
  bool coordinateToOrigin = true;
  bool rawShells = true;
  bool includeProperties = true;
  double distanceThresholdM = 100000.0;
  int zlibLevel = 6;
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
};

CompileResult compileIfcToFrag(const CompileOptions& opts);

}  // namespace ifc2frag
