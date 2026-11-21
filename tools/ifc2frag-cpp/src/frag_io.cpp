#include "frag_io.hpp"
#include "fragments_generated.h"

#include <zlib.h>
#include <fstream>
#include <stdexcept>

namespace ifc2frag {

std::vector<uint8_t> readFileBytes(const std::string& path) {
  std::ifstream ifs(path, std::ios::binary | std::ios::ate);
  if (!ifs) {
    throw std::runtime_error("Could not open file for reading: " + path);
  }
  const auto size = ifs.tellg();
  if (size < 0) {
    throw std::runtime_error("Failed to determine file size: " + path);
  }
  std::vector<uint8_t> buffer(static_cast<size_t>(size));
  ifs.seekg(0, std::ios::beg);
  if (size > 0 && !ifs.read(reinterpret_cast<char*>(buffer.data()), size)) {
    throw std::runtime_error("Failed while reading file: " + path);
  }
  return buffer;
}

void writeFileBytes(const std::string& path, const std::vector<uint8_t>& data) {
  std::ofstream ofs(path, std::ios::binary | std::ios::trunc);
  if (!ofs) {
    throw std::runtime_error("Could not open file for writing: " + path);
  }
  if (!data.empty()) {
    ofs.write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
  }
  if (!ofs) {
    throw std::runtime_error("Failed while writing file: " + path);
  }
}

std::vector<uint8_t> inflateZlib(const std::vector<uint8_t>& compressed) {
  if (compressed.empty()) {
    return {};
  }
  z_stream zs{};
  if (inflateInit(&zs) != Z_OK) {
    throw std::runtime_error("zlib inflateInit failed");
  }
  zs.next_in = const_cast<Bytef*>(compressed.data());
  zs.avail_in = static_cast<uInt>(compressed.size());

  std::vector<uint8_t> out;
  out.resize(compressed.size() * 3 + 4096);

  int ret = Z_OK;
  while (ret == Z_OK) {
    if (zs.total_out >= out.size()) {
      out.resize(out.size() * 2);
    }
    zs.next_out = out.data() + zs.total_out;
    zs.avail_out = static_cast<uInt>(out.size() - zs.total_out);
    ret = inflate(&zs, 0);
  }
  const size_t finalSize = zs.total_out;
  inflateEnd(&zs);

  if (ret != Z_STREAM_END) {
    throw std::runtime_error("zlib inflate failed with code " + std::to_string(ret));
  }
  out.resize(finalSize);
  return out;
}

std::vector<uint8_t> deflateZlibPtr(const uint8_t* data, size_t size, int level) {
  if (!data || size == 0) {
    return {};
  }
  uLongf destLen = compressBound(static_cast<uLong>(size));
  std::vector<uint8_t> out(destLen);
  const int res = compress2(
      out.data(),
      &destLen,
      data,
      static_cast<uLong>(size),
      level);
  if (res != Z_OK) {
    throw std::runtime_error("zlib compress2 failed with code " + std::to_string(res));
  }
  out.resize(destLen);
  return out;
}

std::vector<uint8_t> deflateZlib(const std::vector<uint8_t>& raw, int level) {
  return deflateZlibPtr(raw.data(), raw.size(), level);
}

uint64_t deflatePtrToFile(
    const uint8_t* data,
    size_t size,
    const std::string& outputPath,
    int level,
    const std::function<void(int pct)>& onChunk) {
  std::ofstream ofs(outputPath, std::ios::binary | std::ios::trunc);
  if (!ofs) {
    throw std::runtime_error("Could not open file for writing: " + outputPath);
  }
  if (!data || size == 0) {
    return 0;
  }

  z_stream zs{};
  if (deflateInit(&zs, level) != Z_OK) {
    throw std::runtime_error("zlib deflateInit failed");
  }

  constexpr size_t CHUNK_IN = 2 * 1024 * 1024;
  constexpr size_t CHUNK_OUT = 2 * 1024 * 1024;
  std::vector<uint8_t> outBuf(CHUNK_OUT);

  size_t offset = 0;
  uint64_t totalWritten = 0;
  int lastPct = -1;

  try {
    while (true) {
      const size_t remaining = size - offset;
      const size_t take = remaining > CHUNK_IN ? CHUNK_IN : remaining;
      const int flush = (offset + take >= size) ? Z_FINISH : Z_NO_FLUSH;

      zs.next_in = const_cast<Bytef*>(data + offset);
      zs.avail_in = static_cast<uInt>(take);
      offset += take;

      do {
        zs.next_out = outBuf.data();
        zs.avail_out = static_cast<uInt>(outBuf.size());
        const int ret = deflate(&zs, flush);
        if (ret == Z_STREAM_ERROR) {
          throw std::runtime_error("zlib deflate stream error");
        }
        const size_t have = outBuf.size() - zs.avail_out;
        if (have > 0) {
          ofs.write(reinterpret_cast<const char*>(outBuf.data()), static_cast<std::streamsize>(have));
          if (!ofs) {
            throw std::runtime_error("Failed while writing compressed .frag: " + outputPath);
          }
          totalWritten += have;
        }
      } while (zs.avail_out == 0);

      if (onChunk && size > 0) {
        const int pct = static_cast<int>((offset * 100u) / size);
        if (pct != lastPct && (pct == 100 || pct - lastPct >= 10)) {
          lastPct = pct;
          onChunk(pct);
        }
      }

      if (flush == Z_FINISH) {
        break;
      }
    }
  } catch (...) {
    deflateEnd(&zs);
    throw;
  }

  deflateEnd(&zs);
  return totalWritten;
}

FragStats inspectFragBytes(const std::vector<uint8_t>& compressedOrRaw) {
  FragStats stats{};
  stats.compressedBytes = compressedOrRaw.size();

  const bool looksZlib =
      compressedOrRaw.size() >= 2 &&
      compressedOrRaw[0] == 0x78 &&
      (compressedOrRaw[1] == 0x9C || compressedOrRaw[1] == 0x01 ||
       compressedOrRaw[1] == 0xDA || compressedOrRaw[1] == 0x5E);

  std::vector<uint8_t> raw = looksZlib ? inflateZlib(compressedOrRaw) : compressedOrRaw;
  stats.inflatedBytes = raw.size();

  flatbuffers::Verifier::Options verifierOpts{};
  verifierOpts.max_depth = 128;
  verifierOpts.max_tables = 100000000;
  flatbuffers::Verifier verifier(raw.data(), raw.size(), verifierOpts);
  stats.verified = VerifyModelBuffer(verifier);
  if (!stats.verified) {
    return stats;
  }

  const Model* model = GetModel(raw.data());
  if (!model) {
    stats.verified = false;
    return stats;
  }

  stats.maxLocalId = model->max_local_id();
  if (model->guid()) stats.guid = model->guid()->str();
  if (model->local_ids()) stats.localIdsCount = model->local_ids()->size();
  if (model->categories()) stats.categoriesCount = model->categories()->size();
  if (model->attributes()) stats.attributesCount = model->attributes()->size();
  if (model->relations()) stats.relationsCount = model->relations()->size();

  if (const auto* meshes = model->meshes()) {
    if (meshes->global_transforms()) stats.globalTransformsCount = meshes->global_transforms()->size();
    if (meshes->shells()) stats.shellsCount = meshes->shells()->size();
    if (meshes->circle_extrusions()) stats.circleExtrusionsCount = meshes->circle_extrusions()->size();
    if (meshes->samples()) stats.samplesCount = meshes->samples()->size();
    if (const auto* coords = meshes->coordinates()) {
      stats.coordX = coords->position().x();
      stats.coordY = coords->position().y();
      stats.coordZ = coords->position().z();
    }
  }
  return stats;
}

}  // namespace ifc2frag
