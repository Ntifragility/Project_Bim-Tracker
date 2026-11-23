#include "frag_io.hpp"
#include "ifc_compiler.hpp"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#  include <commdlg.h>
#  include <commctrl.h>
#endif

static void printUsage() {
  std::cout << "ifc2frag - Native 64-bit .ifc -> .frag compiler (v2)\n"
            << "Usage:\n"
            << "  ifc2frag                                     (interactive file picker on Windows)\n"
            << "  ifc2frag <input.ifc> [output.frag] [options] (single file)\n"
            << "  ifc2frag <a.ifc> <b.ifc> ... [options]       (batch files or folders)\n"
            << "  ifc2frag --inspect <model.frag>\n"
            << "Options:\n"
            << "  --bundle                 Output SVF2-Lite .fragbundle/ (auto: 1 chunk <50 MB, spatial zones >=50 MB)\n"
            << "  --single                 Output a single standalone .frag file instead of a .fragbundle/\n"
            << "  --split-spatial          Output SVF2-Lite .fragbundle/ (Principal Structure + Spatial Detail Grid)\n"
            << "  --split-by-storey        Output SVF2-Lite .fragbundle/ (one .frag per floor + manifest.json)\n"
            << "  --split-by-category      Output SVF2-Lite .fragbundle/ (one .frag per discipline + manifest.json)\n"
            << "  --skip-fasteners         Skip IFCFASTENER & IFCMECHANICALFASTENER before tessellation (faster + smaller)\n"
            << "  --out-dir <folder>       Custom output directory for .fragbundle/\n"
            << "  --circle-segments <4-32> Pipe/conduit tessellation segments (default: 12; 8 for split bundles)\n"
            << "  --fast                   Use zlib level 1 (faster, slightly larger)\n"
            << "  --zlib-level <1-9>       Set zlib compression level (default: 6)\n"
            << "  --threads <N>            Worker threads for shell building (default: auto)\n"
            << "  --no-props               Skip IFC property sets & relations (geometry only)\n"
            << "  --exclude <C1,C2,...>    Skip IFC categories (e.g. IFCSPACE,IFCANNOTATION)\n"
            << "  --only <C1,C2,...>       Compile only listed IFC categories\n"
            << "  --no-origin              Disable COORDINATE_TO_ORIGIN\n";
}

static std::vector<std::string> splitCsv(const std::string& csv) {
  std::vector<std::string> out;
  std::stringstream ss(csv);
  std::string item;
  while (std::getline(ss, item, ',')) {
    const size_t start = item.find_first_not_of(" \t");
    if (start == std::string::npos) continue;
    const size_t end = item.find_last_not_of(" \t");
    out.push_back(item.substr(start, end - start + 1));
  }
  return out;
}

static bool hasExtensionCi(const std::filesystem::path& p, const std::string& extLower) {
  std::string e = p.extension().string();
  for (char& c : e) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return e == extLower;
}

struct CompileJob {
  std::string inputPath;
  std::string outputPath;
};

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

static bool pickIfcInputFiles(std::vector<std::string>& outPaths) {
  std::vector<wchar_t> buf(65536, L'\0');
  OPENFILENAMEW ofn{};
  ofn.lStructSize = sizeof(ofn);
  ofn.lpstrFilter = L"IFC Files (*.ifc)\0*.ifc\0All Files (*.*)\0*.*\0";
  ofn.lpstrFile = buf.data();
  ofn.nMaxFile = static_cast<DWORD>(buf.size());
  ofn.lpstrTitle = L"Select one or more IFC files to compile to .frag";
  ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR | OFN_ALLOWMULTISELECT | OFN_EXPLORER;
  if (!GetOpenFileNameW(&ofn)) return false;

  const wchar_t* p = buf.data();
  const std::wstring first(p);
  p += first.size() + 1;
  if (*p == L'\0') {
    outPaths.push_back(wideToUtf8(first));
  } else {
    const std::filesystem::path dir(first);
    while (*p != L'\0') {
      const std::wstring fname(p);
      outPaths.push_back(wideToUtf8((dir / fname).wstring()));
      p += fname.size() + 1;
    }
  }
  return !outPaths.empty();
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

// Native Win32 progress window with Cancel button for double-click mode (Option 3A)
constexpr UINT WM_PROGRESS_UPDATE = WM_APP + 1;
constexpr UINT WM_COMPILE_DONE = WM_APP + 2;
constexpr int IDC_BTN_CANCEL = 1001;
constexpr UINT_PTR TIMER_ELAPSED = 1;

struct ProgressDialogState {
  HWND hwnd = nullptr;
  HWND lblFile = nullptr;
  HWND lblStage = nullptr;
  HWND lblTime = nullptr;
  HWND bar = nullptr;
  HWND btnCancel = nullptr;
  std::mutex mtx;
  std::string fileText;
  std::string stageText;
  int progressPct = 0;
  std::atomic<bool> cancelRequested{false};
  std::atomic<bool> done{false};
  bool cancelled = false;
  std::string errorText;
  std::string summaryText;
  std::chrono::steady_clock::time_point startTime = std::chrono::steady_clock::now();
};

static LRESULT CALLBACK progressWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  auto* st = reinterpret_cast<ProgressDialogState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  switch (msg) {
    case WM_CREATE: {
      auto* cs = reinterpret_cast<CREATESTRUCTW*>(lParam);
      st = reinterpret_cast<ProgressDialogState*>(cs->lpCreateParams);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
      HFONT hFont = static_cast<HFONT>(GetStockObject(DEFAULT_GUI_FONT));

      st->lblFile = CreateWindowExW(0, L"STATIC", L"Preparing...", WS_CHILD | WS_VISIBLE | SS_PATHELLIPSIS,
                                    16, 14, 448, 20, hwnd, nullptr, cs->hInstance, nullptr);
      st->lblStage = CreateWindowExW(0, L"STATIC", L"Initializing...", WS_CHILD | WS_VISIBLE | SS_ENDELLIPSIS,
                                     16, 38, 448, 20, hwnd, nullptr, cs->hInstance, nullptr);
      st->bar = CreateWindowExW(0, PROGRESS_CLASSW, nullptr, WS_CHILD | WS_VISIBLE | PBS_SMOOTH,
                                16, 66, 448, 22, hwnd, nullptr, cs->hInstance, nullptr);
      SendMessageW(st->bar, PBM_SETRANGE, 0, MAKELPARAM(0, 100));
      st->lblTime = CreateWindowExW(0, L"STATIC", L"Elapsed: 0.0 s", WS_CHILD | WS_VISIBLE,
                                    16, 98, 220, 20, hwnd, nullptr, cs->hInstance, nullptr);
      st->btnCancel = CreateWindowExW(0, L"BUTTON", L"Cancel", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                                      374, 94, 90, 26, hwnd, reinterpret_cast<HMENU>(IDC_BTN_CANCEL), cs->hInstance, nullptr);

      SendMessageW(st->lblFile, WM_SETFONT, reinterpret_cast<WPARAM>(hFont), TRUE);
      SendMessageW(st->lblStage, WM_SETFONT, reinterpret_cast<WPARAM>(hFont), TRUE);
      SendMessageW(st->lblTime, WM_SETFONT, reinterpret_cast<WPARAM>(hFont), TRUE);
      SendMessageW(st->btnCancel, WM_SETFONT, reinterpret_cast<WPARAM>(hFont), TRUE);
      SetTimer(hwnd, TIMER_ELAPSED, 250, nullptr);
      return 0;
    }
    case WM_COMMAND:
      if (LOWORD(wParam) == IDC_BTN_CANCEL && st) {
        st->cancelRequested.store(true);
        EnableWindow(st->btnCancel, FALSE);
        SetWindowTextW(st->btnCancel, L"Cancelling...");
        return 0;
      }
      break;
    case WM_TIMER:
      if (wParam == TIMER_ELAPSED && st && !st->done.load()) {
        const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - st->startTime).count();
        std::wostringstream ws;
        ws << L"Elapsed: " << std::fixed << std::setprecision(1) << sec << L" s";
        SetWindowTextW(st->lblTime, ws.str().c_str());
      }
      return 0;
    case WM_PROGRESS_UPDATE:
      if (st) {
        std::string f, s;
        int pct = 0;
        {
          std::lock_guard<std::mutex> lk(st->mtx);
          f = st->fileText;
          s = st->stageText;
          pct = st->progressPct;
        }
        SetWindowTextW(st->lblFile, utf8ToWide(f).c_str());
        SetWindowTextW(st->lblStage, utf8ToWide(s).c_str());
        SendMessageW(st->bar, PBM_SETPOS, static_cast<WPARAM>(pct), 0);
      }
      return 0;
    case WM_COMPILE_DONE:
      KillTimer(hwnd, TIMER_ELAPSED);
      DestroyWindow(hwnd);
      return 0;
    case WM_CLOSE:
      if (st && !st->done.load()) {
        st->cancelRequested.store(true);
        EnableWindow(st->btnCancel, FALSE);
        SetWindowTextW(st->btnCancel, L"Cancelling...");
        return 0;
      }
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static int runBatchWithDialog(const std::vector<CompileJob>& jobs, const ifc2frag::CompileOptions& baseOpts) {
#  ifdef IFC2FRAG_HAS_WEBIFC
  INITCOMMONCONTROLSEX icc{sizeof(icc), ICC_PROGRESS_CLASS};
  InitCommonControlsEx(&icc);

  HINSTANCE hInst = GetModuleHandleW(nullptr);
  const wchar_t* clsName = L"Ifc2FragProgressClass";
  WNDCLASSW wc{};
  wc.lpfnWndProc = progressWndProc;
  wc.hInstance = hInst;
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_BTNFACE + 1);
  wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  wc.lpszClassName = clsName;
  RegisterClassW(&wc);

  ProgressDialogState st{};
  const int w = 496, h = 168;
  const int sx = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
  const int sy = (GetSystemMetrics(SM_CYSCREEN) - h) / 2;
  st.hwnd = CreateWindowExW(
      WS_EX_DLGMODALFRAME, clsName, L"ifc2frag - Compiling IFC to .frag",
      WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
      sx, sy, w, h, nullptr, nullptr, hInst, &st);
  ShowWindow(st.hwnd, SW_SHOW);
  UpdateWindow(st.hwnd);

  std::thread worker([&]() {
    std::ostringstream summary;
    try {
      for (size_t i = 0; i < jobs.size(); ++i) {
        ifc2frag::CompileOptions runOpts = baseOpts;
        runOpts.inputPath = jobs[i].inputPath;
        runOpts.outputPath = jobs[i].outputPath;
        runOpts.cancelRequested = &st.cancelRequested;

        const std::string fileLabel =
            "[" + std::to_string(i + 1) + "/" + std::to_string(jobs.size()) + "] " +
            std::filesystem::path(jobs[i].inputPath).filename().string();

        runOpts.onProgress = [&](int stage, int totalStages, const std::string& message) {
          const int stagePct = std::min(100, std::max(0, (stage * 100) / std::max(1, totalStages)));
          const int overallPct = static_cast<int>(((i * 100u) + static_cast<size_t>(stagePct)) / jobs.size());
          {
            std::lock_guard<std::mutex> lk(st.mtx);
            st.fileText = fileLabel;
            st.stageText = "[" + std::to_string(stage) + "/" + std::to_string(totalStages) + "] " + message;
            st.progressPct = overallPct;
          }
          PostMessageW(st.hwnd, WM_PROGRESS_UPDATE, 0, 0);
        };

        const auto res = ifc2frag::compileIfcToFrag(runOpts);
        if (!res.chunks.empty()) {
          const auto bundleFolder = std::filesystem::path(res.manifestPath).parent_path().string();
          summary << bundleFolder << "\n"
                  << "  Chunks:      " << res.chunks.size() << " floor files + manifest.json\n"
                  << "  Elements:    " << res.elementsProcessed << "\n"
                  << "  Total Size:  " << std::fixed << std::setprecision(2)
                  << (res.compressedFragBytes / (1024.0 * 1024.0)) << " MB\n"
                  << "  Time:        " << res.elapsedSeconds << " s\n\n";
        } else {
          summary << std::filesystem::path(jobs[i].outputPath).filename().string() << "\n"
                  << "  Elements:    " << res.elementsProcessed << "\n"
                  << "  Shells:      " << res.uniqueShells << " (Samples: " << res.samplesCount << ")\n"
                  << "  Psets:       " << res.propertySetsCount << " (Relations: " << res.relationsCount << ")\n"
                  << "  Size:        " << std::fixed << std::setprecision(2)
                  << (res.compressedFragBytes / (1024.0 * 1024.0)) << " MB (from "
                  << (res.rawFlatBufferBytes / (1024.0 * 1024.0)) << " MB FB)\n"
                  << "  Time:        " << res.elapsedSeconds << " s\n\n";
        }
      }
      st.summaryText = summary.str();
    } catch (const ifc2frag::CompileCancelledError&) {
      st.cancelled = true;
    } catch (const std::exception& ex) {
      st.errorText = ex.what();
    }
    st.done.store(true);
    PostMessageW(st.hwnd, WM_COMPILE_DONE, 0, 0);
  });

  MSG msg{};
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  if (worker.joinable()) worker.join();

  if (st.cancelled) {
    MessageBoxW(nullptr, L"Compilation was cancelled.", L"ifc2frag - Cancelled", MB_OK | MB_ICONWARNING);
    return 1;
  }
  if (!st.errorText.empty()) {
    MessageBoxW(nullptr, utf8ToWide(st.errorText).c_str(), L"ifc2frag - Conversion Error", MB_OK | MB_ICONERROR);
    return 1;
  }
  MessageBoxW(nullptr, utf8ToWide(st.summaryText).c_str(), L"ifc2frag - Conversion Complete", MB_OK | MB_ICONINFORMATION);
  return 0;
#  else
  (void)jobs;
  (void)baseOpts;
  MessageBoxW(nullptr, L"Built without IFC2FRAG_WITH_WEBIFC.", L"ifc2frag - Error", MB_OK | MB_ICONERROR);
  return 1;
#  endif
}
#endif

static int runBatchConsole(const std::vector<CompileJob>& jobs, const ifc2frag::CompileOptions& baseOpts) {
#ifdef IFC2FRAG_HAS_WEBIFC
  int failures = 0;
  for (size_t i = 0; i < jobs.size(); ++i) {
    ifc2frag::CompileOptions runOpts = baseOpts;
    runOpts.inputPath = jobs[i].inputPath;
    runOpts.outputPath = jobs[i].outputPath;
    runOpts.onProgress = [](int stage, int totalStages, const std::string& message) {
      std::cout << "  [" << stage << "/" << totalStages << "] " << message << std::endl;
    };
    try {
      if (jobs.size() > 1) {
        std::cout << "=== File [" << (i + 1) << "/" << jobs.size() << "] ===\n";
      }
      std::cout << "Compiling " << runOpts.inputPath << " -> " << runOpts.outputPath << " ...\n";
      const auto res = ifc2frag::compileIfcToFrag(runOpts);
      if (!res.chunks.empty()) {
        std::cout << "Compiled chunked bundle: " << res.manifestPath << "\n"
                  << "  Chunks:      " << res.chunks.size() << "\n"
                  << "  Elements:    " << res.elementsProcessed << "\n"
                  << "  Compressed:  " << (res.compressedFragBytes / (1024.0 * 1024.0)) << " MB total\n"
                  << "  Time:        " << res.elapsedSeconds << " s\n";
      } else {
        std::cout << "Compiled " << runOpts.inputPath << " -> " << runOpts.outputPath << "\n"
                  << "  Elements:    " << res.elementsProcessed << "\n"
                  << "  Shells:      " << res.uniqueShells << "\n"
                  << "  Samples:     " << res.samplesCount << "\n"
                  << "  Psets:       " << res.propertySetsCount << "\n"
                  << "  Relations:   " << res.relationsCount << "\n"
                  << "  FlatBuffer:  " << (res.rawFlatBufferBytes / (1024.0 * 1024.0)) << " MB\n"
                  << "  Compressed:  " << (res.compressedFragBytes / (1024.0 * 1024.0)) << " MB\n"
                  << "  Time:        " << res.elapsedSeconds << " s\n";
      }
    } catch (const std::exception& ex) {
      std::cerr << "ERROR (" << runOpts.inputPath << "): " << ex.what() << "\n";
      ++failures;
    }
  }
  return failures == 0 ? 0 : 1;
#else
  (void)jobs;
  (void)baseOpts;
  std::cerr << "ERROR: This build of ifc2frag was compiled without IFC2FRAG_WITH_WEBIFC.\n";
  return 1;
#endif
}

int main(int argc, char** argv) {
  namespace fs = std::filesystem;

  // Interactive double-click mode on Windows (no arguments)
  if (argc == 1) {
#ifdef _WIN32
    std::vector<std::string> inputPaths;
    if (!pickIfcInputFiles(inputPaths)) {
      return 0;  // User cancelled
    }
    const int boltChoice = MessageBoxW(
        nullptr,
        L"Output format: SVF2-Lite .fragbundle folder (auto 1-chunk for <50 MB IFC, Principal + Spatial Zones for >=50 MB).\n\n"
        L"Skip tiny bolts & fasteners (IFCFASTENER / IFCMECHANICALFASTENER) for faster compile & cleaner conduit tracing?\n\n"
        L"  • YES    = Skip bolts/fasteners (fastest, recommended for conduit takeoff)\n"
        L"  • NO     = Keep 100% of bolts/fasteners\n"
        L"  • CANCEL = Abort",
        L"ifc2frag - Compile to .fragbundle",
        MB_YESNOCANCEL | MB_ICONQUESTION);
    if (boltChoice == IDCANCEL) {
      return 0;
    }

    ifc2frag::CompileOptions opts{};
    opts.splitMode = ifc2frag::SplitMode::AutoBundle;
    opts.skipFasteners = (boltChoice == IDYES);
    opts.circleSegments = 8;
    opts.zlibLevel = 1;
    std::vector<CompileJob> jobs;
    for (const auto& inPath : inputPaths) {
      fs::path outDir = fs::path(inPath).parent_path() / (fs::path(inPath).stem().string() + ".fragbundle");
      jobs.push_back({inPath, outDir.string()});
    }
    if (jobs.size() == 1) {
      opts.outDir = jobs[0].outputPath;
    }
    return runBatchWithDialog(jobs, opts);
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

  // Parse CLI positional paths and flags
  ifc2frag::CompileOptions opts{};
  bool circleSegsExplicit = false;
  std::vector<std::string> positional;
  for (int i = 1; i < argc; ++i) {
    const std::string flag = argv[i];
    if (flag == "--no-origin") {
      opts.coordinateToOrigin = false;
    } else if (flag == "--bundle") {
      opts.splitMode = ifc2frag::SplitMode::AutoBundle;
    } else if (flag == "--single") {
      opts.splitMode = ifc2frag::SplitMode::None;
    } else if (flag == "--skip-fasteners") {
      opts.skipFasteners = true;
    } else if (flag == "--split-spatial") {
      opts.splitMode = ifc2frag::SplitMode::Spatial;
    } else if (flag == "--split-by-storey") {
      opts.splitMode = ifc2frag::SplitMode::ByStorey;
    } else if (flag == "--split-by-category") {
      opts.splitMode = ifc2frag::SplitMode::ByCategory;
    } else if (flag == "--out-dir" && i + 1 < argc) {
      opts.outDir = argv[++i];
    } else if (flag == "--circle-segments" && i + 1 < argc) {
      opts.circleSegments = std::atoi(argv[++i]);
      circleSegsExplicit = true;
    } else if (flag == "--fast") {
      opts.zlibLevel = 1;
    } else if (flag == "--no-props") {
      opts.includeProperties = false;
    } else if (flag == "--with-props") {
      opts.includeProperties = true;
      opts.forceProperties = true;
    } else if (flag == "--zlib-level" && i + 1 < argc) {
      opts.zlibLevel = std::atoi(argv[++i]);
    } else if (flag == "--threads" && i + 1 < argc) {
      opts.threads = static_cast<uint32_t>(std::max(0, std::atoi(argv[++i])));
    } else if (flag == "--exclude" && i + 1 < argc) {
      auto cats = splitCsv(argv[++i]);
      opts.excludeCategories.insert(opts.excludeCategories.end(), cats.begin(), cats.end());
    } else if (flag == "--only" && i + 1 < argc) {
      auto cats = splitCsv(argv[++i]);
      opts.onlyCategories.insert(opts.onlyCategories.end(), cats.begin(), cats.end());
    } else if (flag.rfind("--", 0) == 0) {
      std::cerr << "Unknown option: " << flag << "\n";
      printUsage();
      return 1;
    } else {
      positional.push_back(flag);
    }
  }
  if (opts.splitMode != ifc2frag::SplitMode::None && !circleSegsExplicit) {
    opts.circleSegments = 8;
  }

  if (positional.empty()) {
    printUsage();
    return 1;
  }

  std::vector<CompileJob> jobs;
  if (positional.size() == 2 && !fs::is_directory(positional[0]) && hasExtensionCi(positional[1], ".frag")) {
    jobs.push_back({positional[0], positional[1]});
  } else {
    for (const auto& pStr : positional) {
      const fs::path p(pStr);
      if (fs::is_directory(p)) {
        for (const auto& entry : fs::directory_iterator(p)) {
          if (entry.is_regular_file() && hasExtensionCi(entry.path(), ".ifc")) {
            fs::path outP = entry.path();
            outP.replace_extension(".frag");
            jobs.push_back({entry.path().string(), outP.string()});
          }
        }
      } else {
        fs::path outP = p;
        outP.replace_extension(".frag");
        jobs.push_back({p.string(), outP.string()});
      }
    }
  }

  if (jobs.empty()) {
    std::cerr << "ERROR: No .ifc files found to compile.\n";
    return 1;
  }

  return runBatchConsole(jobs, opts);
}
