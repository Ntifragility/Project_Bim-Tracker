#include "frag_io.hpp"
#include "ifc_compiler.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

static void printUsage() {
  std::cout << "ifc2frag - Native 64-bit .ifc -> .frag compiler\n"
            << "Usage:\n"
            << "  ifc2frag --inspect <model.frag>\n"
            << "  ifc2frag <input.ifc> <output.frag> [--no-origin] [--zlib-level <1-9>]\n";
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

#ifdef IFC2FRAG_HAS_WEBIFC
  ifc2frag::CompileOptions opts{};
  opts.inputPath = argv[1];
  opts.outputPath = argv[2];
  for (int i = 3; i < argc; ++i) {
    const std::string flag = argv[i];
    if (flag == "--no-origin") {
      opts.coordinateToOrigin = false;
    } else if (flag == "--zlib-level" && i + 1 < argc) {
      opts.zlibLevel = std::atoi(argv[++i]);
    }
  }

  try {
    const auto res = ifc2frag::compileIfcToFrag(opts);
    std::cout << "Compiled " << opts.inputPath << " -> " << opts.outputPath << "\n"
              << "  Elements:    " << res.elementsProcessed << "\n"
              << "  Shells:      " << res.uniqueShells << "\n"
              << "  Samples:     " << res.samplesCount << "\n"
              << "  FlatBuffer:  " << (res.rawFlatBufferBytes / (1024.0 * 1024.0)) << " MB\n"
              << "  Compressed:  " << (res.compressedFragBytes / (1024.0 * 1024.0)) << " MB\n"
              << "  Time:        " << res.elapsedSeconds << " s\n";
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "ERROR: " << ex.what() << "\n";
    return 1;
  }
#else
  std::cerr << "ERROR: This build of ifc2frag was compiled without IFC2FRAG_WITH_WEBIFC.\n";
  return 1;
#endif
}
