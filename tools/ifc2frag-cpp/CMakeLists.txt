cmake_minimum_required(VERSION 3.22)
project(ifc2frag VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)

# 1. FlatBuffers (schema compiler flatc + runtime headers)
set(FLATBUFFERS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(FLATBUFFERS_BUILD_FLATLIB ON CACHE BOOL "" FORCE)
set(FLATBUFFERS_BUILD_FLATC ON CACHE BOOL "" FORCE)
FetchContent_Declare(
  flatbuffers
  GIT_REPOSITORY https://github.com/google/flatbuffers.git
  GIT_TAG        v24.3.25
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(flatbuffers)

# 2. zlib (RFC 1950 deflate/inflate matching pako in @thatopen/fragments)
set(ZLIB_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
FetchContent_Declare(
  zlib
  GIT_REPOSITORY https://github.com/madler/zlib.git
  GIT_TAG        v1.3.1
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(zlib)
# Exclude zlib shared DLL target (avoids MinGW windres failing on spaces in workspace path)
if(TARGET zlib)
  set_target_properties(zlib PROPERTIES EXCLUDE_FROM_ALL TRUE)
endif()

# 2b. web-ifc 0.77 native 64-bit C++ core (Phase 2; enable when >= 1.5 GB free space is available)
option(IFC2FRAG_WITH_WEBIFC "Fetch and link native web-ifc 0.77 C++ core" OFF)
if(IFC2FRAG_WITH_WEBIFC)
  FetchContent_Declare(
    web_ifc
    GIT_REPOSITORY https://github.com/ThatOpen/engine_web-ifc.git
    GIT_TAG        0.77
    GIT_SHALLOW    TRUE
    SOURCE_SUBDIR  src/cpp
  )
  FetchContent_MakeAvailable(web_ifc)
endif()

# 3. Generate C++ FlatBuffers header from @thatopen/fragments schema
set(FRAG_SCHEMA "${CMAKE_CURRENT_SOURCE_DIR}/schema/fragments.fbs")
set(FRAG_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(FRAG_GEN_HDR "${FRAG_GEN_DIR}/fragments_generated.h")

file(MAKE_DIRECTORY "${FRAG_GEN_DIR}")
add_custom_command(
  OUTPUT "${FRAG_GEN_HDR}"
  COMMAND $<TARGET_FILE:flatc> --cpp -o "${FRAG_GEN_DIR}" "${FRAG_SCHEMA}"
  DEPENDS "${FRAG_SCHEMA}" flatc
  COMMENT "Generating fragments_generated.h from fragments.fbs"
)
add_custom_target(fragments_schema DEPENDS "${FRAG_GEN_HDR}")

# 4. Core library (shared between CLI and parity tests)
set(FRAG_CORE_SOURCES
  src/frag_io.cpp
  "${FRAG_GEN_HDR}"
)
if(IFC2FRAG_WITH_WEBIFC)
  list(APPEND FRAG_CORE_SOURCES src/ifc_compiler.cpp)
endif()

add_library(frag_core STATIC ${FRAG_CORE_SOURCES})
add_dependencies(frag_core fragments_schema)
target_include_directories(frag_core PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
  "${FRAG_GEN_DIR}"
  "${zlib_SOURCE_DIR}"
  "${zlib_BINARY_DIR}"
)
target_link_libraries(frag_core PUBLIC flatbuffers zlibstatic)
if(IFC2FRAG_WITH_WEBIFC)
  target_link_libraries(frag_core PUBLIC web-ifc-library)
  target_compile_definitions(frag_core PUBLIC IFC2FRAG_HAS_WEBIFC=1)
endif()

if(MINGW)
  set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -static -static-libgcc -static-libstdc++")
endif()

# 5. CLI executable
add_executable(ifc2frag
  src/main.cpp
)
target_link_libraries(ifc2frag PRIVATE frag_core)
if(WIN32)
  target_link_libraries(ifc2frag PRIVATE comdlg32 comctl32)
endif()

# 6. Phase 1 Schema Parity Test
enable_testing()
add_executable(frag_schema_parity_test
  tests/parity_test.cpp
)
target_link_libraries(frag_schema_parity_test PRIVATE frag_core)
target_compile_definitions(frag_schema_parity_test PRIVATE
  PROJECT_ROOT_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../.."
)
add_test(NAME frag_schema_parity_test COMMAND frag_schema_parity_test)
