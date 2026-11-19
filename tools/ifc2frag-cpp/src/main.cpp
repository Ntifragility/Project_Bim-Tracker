#include "frag_io.hpp"

#include <iostream>
#include <string>

static void printUsage() {
  std::cout << "ifc2frag - Native 64-bit .ifc -> .frag compiler (Phase 1)\n"
            << "Usage:\n"
            << "  ifc2frag --inspect <model.frag>\n";
}

int main(int argc, char** argv) {
  if (argc < 3) {
    printUsage();
    return 1;
  }

  const std::string arg1 = argv[1];
  if (arg1 == "--inspect") {
    try {
      const auto bytes = ifc2frag::readFileBytes(argv[2]);
      const auto stats = ifc2frag::inspectFragBytes(bytes);
      if (!stats.verified) {
        std::cerr << "ERROR: FlatBuffers Model verification failed.\n";
        return 2;
      }
      std::cout << "Verified @thatopen/fragments Model:\n"
                << "  GUID:             " << stats.guid << "\n"
                << "  Compressed bytes: " << stats.compressedBytes << "\n"
                << "  Inflated bytes:   " << stats.inflatedBytes << "\n"
                << "  maxLocalId:       " << stats.maxLocalId << "\n"
                << "  localIds:         " << stats.localIdsCount << "\n"
                << "  categories:       " << stats.categoriesCount << "\n"
                << "  globalTransforms: " << stats.globalTransformsCount << "\n"
                << "  shells:           " << stats.shellsCount << "\n"
                << "  samples:          " << stats.samplesCount << "\n"
                << "  attributes:       " << stats.attributesCount << "\n"
                << "  relations:        " << stats.relationsCount << "\n"
                << "  origin coords:    (" << stats.coordX << ", " << stats.coordY << ", " << stats.coordZ << ")\n";
      return 0;
    } catch (const std::exception& ex) {
      std::cerr << "ERROR: " << ex.what() << "\n";
      return 1;
    }
  }

  printUsage();
  return 1;
}
