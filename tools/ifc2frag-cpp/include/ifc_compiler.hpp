#pragma once

#include <cstdint>
#include <string>

namespace ifc2frag {

struct CompileOptions {
  std::string inputPath;
  std::string outputPath;
  bool coordinateToOrigin = true;
  bool rawShells = true;
  double distanceThresholdM = 100000.0;
  int zlibLevel = 6;
  uint32_t threads = 0;
};

struct CompileResult {
  uint32_t elementsProcessed = 0;
  uint32_t uniqueShells = 0;
  uint32_t samplesCount = 0;
  uint64_t rawFlatBufferBytes = 0;
  uint64_t compressedFragBytes = 0;
  double elapsedSeconds = 0.0;
};

CompileResult compileIfcToFrag(const CompileOptions& opts);

}  // namespace ifc2frag
