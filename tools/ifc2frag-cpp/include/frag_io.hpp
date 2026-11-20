#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace ifc2frag {

struct FragStats {
  uint64_t compressedBytes = 0;
  uint64_t inflatedBytes = 0;
  uint32_t maxLocalId = 0;
  size_t localIdsCount = 0;
  size_t categoriesCount = 0;
  size_t globalTransformsCount = 0;
  size_t shellsCount = 0;
  size_t circleExtrusionsCount = 0;
  size_t samplesCount = 0;
  size_t attributesCount = 0;
  size_t relationsCount = 0;
  double coordX = 0.0;
  double coordY = 0.0;
  double coordZ = 0.0;
  bool verified = false;
  std::string guid;
};

std::vector<uint8_t> readFileBytes(const std::string& path);
void writeFileBytes(const std::string& path, const std::vector<uint8_t>& data);

std::vector<uint8_t> inflateZlib(const std::vector<uint8_t>& compressed);
std::vector<uint8_t> deflateZlib(const std::vector<uint8_t>& raw, int level = 6);
std::vector<uint8_t> deflateZlibPtr(const uint8_t* data, size_t size, int level = 6);

FragStats inspectFragBytes(const std::vector<uint8_t>& compressedOrRaw);

}  // namespace ifc2frag
