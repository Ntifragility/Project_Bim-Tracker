#include "frag_io.hpp"
#include "ifc_compiler.hpp"

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <string>

#ifdef _WIN32
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#  include <commdlg.h>
#endif

static void printUsage() {
  std::cout << "ifc2frag - Native 64-bit .ifc -> .frag compiler\n"
            << "Usage:\n"
            << "  ifc2frag                              (interactive file picker on Windows)\n"
            << "  ifc2frag <input.ifc>                  (writes <input>.frag next to input)\n"
            << "  ifc2frag <input.ifc> <output.frag> [--no-origin] [--zlib-level <1-9>]\n"
            << "  ifc2frag --inspect <model.frag>\n";
}

#ifdef _WIN32
static std::string wideToUtf8(const std::wstring& w) {
  if (w.empty()) return {};
  int len = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), static_cast<int>(w.size()), out.data(), len, nullptr, nullptr);
  return out;
}

static std::wstring utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring out(static_cast<size_t>(len), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), out.data(), len);
  return out;
}

static bool pickIfcInputFile(std::string& outPath) {
  wchar_t buf[MAX_PATH * 4] = {0};
  OPENFILENAMEW ofn{};
  ofn.lStructSize = sizeof(ofn);
  ofn.lpstrFilter = L"IFC Files (*.ifc)\0*.ifc\0All Files (*.*)\0*.*\0";
  ofn.lpstrFile = buf;
  ofn.nMaxFile = sizeof(buf) / sizeof(wchar_t);
  ofn.lpstrTitle = L"Select an IFC file to compile to .frag";
  ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetOpenFileNameW(&ofn)) return false;
  outPath = wideToUtf8(buf);
  return true;
}

static bool pickFragOutputFile(const std::string& defaultPath, std::string& outPath) {
  wchar_t buf[MAX_PATH * 4] = {0};
  const std::wstring wDefault = utf8ToWide(defaultPath);
  if (wDefault.size() < (sizeof(buf) / sizeof(wchar_t))) {
    std::copy(wDefault.begin(), wDefault.end(), buf);
  }
  OPENFILENAMEW ofn{};
  ofn.lStructSize = sizeof(ofn);
  ofn.lpstrFilter = L"Fragments Cache (*.frag)\0*.frag\0All Files (*.*)\0*.*\0";
  ofn.lpstrFile = buf;
  ofn.nMaxFile = sizeof(buf) / sizeof(wchar_t);
  ofn.lpstrDefExt = L"frag";
  ofn.lpstrTitle = L"Save compiled .frag file";
  ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetSaveFileNameW(&ofn)) return false;
  outPath = wideToUtf8(buf);
  return true;
}
#endif

static int runCompile(const ifc2frag::CompileOptions& opts, bool showDialog) {
#ifdef IFC2FRAG_HAS_WEBIFC
  try {
    std::cout << "Compiling " << opts.inputPath << " -> " << opts.outputPath << " ...\n";
    ifc2frag::CompileOptions runOpts = opts;
    if (!runOpts.onProgress) {
      runOpts.onProgress = [](int stage, int totalStages, const std::string& message) {
        std::cout << "  [" << stage << "/" << totalStages << "] " << message << std::endl;
      };
    }
    const auto res = ifc2frag::compileIfcToFrag(runOpts);
    std::ostringstream summary;
    summary << "Compiled " << opts.inputPath << " -> " << opts.outputPath << "\n"
            << "  Elements:    " << res.elementsProcessed << "\n"
            << "  Shells:      " << res.uniqueShells << "\n"
            << "  Samples:     " << res.samplesCount << "\n"
            << "  FlatBuffer:  " << (res.rawFlatBufferBytes / (1024.0 * 1024.0)) << " MB\n"
            << "  Compressed:  " << (res.compressedFragBytes / (1024.0 * 1024.0)) << " MB\n"
            << "  Time:        " << res.elapsedSeconds << " s\n";
    std::cout << summary.str();
#  ifdef _WIN32
    if (showDialog) {
      MessageBoxW(nullptr, utf8ToWide(summary.str()).c_str(), L"ifc2frag - Conversion Complete", MB_OK | MB_ICONINFORMATION);
    }
#  else
    (void)showDialog;
#  endif
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "ERROR: " << ex.what() << "\n";
#  ifdef _WIN32
    if (showDialog) {
      MessageBoxW(nullptr, utf8ToWide(ex.what()).c_str(), L"ifc2frag - Conversion Error", MB_OK | MB_ICONERROR);
    }
#  endif
    return 1;
  }
#else
  (void)opts;
  (void)showDialog;
  std::cerr << "ERROR: This build of ifc2frag was compiled without IFC2FRAG_WITH_WEBIFC.\n";
  return 1;
#endif
}

int main(int argc, char** argv) {
  namespace fs = std::filesystem;

  // Interactive double-click mode on Windows (no arguments)
  if (argc == 1) {
#ifdef _WIN32
    std::string inputPath;
    if (!pickIfcInputFile(inputPath)) {
      return 0;  // User cancelled
    }
    fs::path defaultOut = fs::path(inputPath);
    defaultOut.replace_extension(".frag");
    std::string outputPath;
    if (!pickFragOutputFile(defaultOut.string(), outputPath)) {
      return 0;  // User cancelled
    }
    ifc2frag::CompileOptions opts{};
    opts.inputPath = inputPath;
    opts.outputPath = outputPath;
    return runCompile(opts, true);
#else
    printUsage();
    return 1;
#endif
  }

  const std::string arg1 = argv[1];
  if (arg1 == "--help" || arg1 == "-h") {
    printUsage();
    return 0;
  }

  if (arg1 == "--inspect") {
    if (argc < 3) {
      printUsage();
      return 1;
    }
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

  // Drag-and-drop single file onto ifc2frag.exe, or full CLI args
  ifc2frag::CompileOptions opts{};
  opts.inputPath = arg1;
  if (argc >= 3 && std::string(argv[2]).rfind("--", 0) != 0) {
    opts.outputPath = argv[2];
    for (int i = 3; i < argc; ++i) {
      const std::string flag = argv[i];
      if (flag == "--no-origin") {
        opts.coordinateToOrigin = false;
      } else if (flag == "--zlib-level" && i + 1 < argc) {
        opts.zlibLevel = std::atoi(argv[++i]);
      }
    }
  } else {
    fs::path p(arg1);
    p.replace_extension(".frag");
    opts.outputPath = p.string();
    for (int i = 2; i < argc; ++i) {
      const std::string flag = argv[i];
      if (flag == "--no-origin") {
        opts.coordinateToOrigin = false;
      } else if (flag == "--zlib-level" && i + 1 < argc) {
        opts.zlibLevel = std::atoi(argv[++i]);
      }
    }
  }

  return runCompile(opts, false);
}
