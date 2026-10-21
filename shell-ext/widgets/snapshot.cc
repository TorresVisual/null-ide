#include "snapshot.h"

#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/base.h>

using namespace winrt::Windows::Data::Json;

namespace null_widgets {

std::wstring CapText(std::wstring const& s, size_t maxLen) {
  std::wstring out = s;
  for (auto& c : out) {
    if (c < 0x20 || c == 0x7f) c = L' ';
  }
  if (out.size() > maxLen) {
    out.resize(maxLen);
    out.push_back(L'\u2026');
  }
  return out;
}

bool IsSafeGithubUrl(std::wstring const& u) {
  static constexpr wchar_t kPrefix[] = L"https://github.com/";
  constexpr size_t kPrefixLen = 19;
  if (u.size() <= kPrefixLen || u.size() > 300 || u.compare(0, kPrefixLen, kPrefix) != 0) return false;
  for (size_t i = kPrefixLen; i < u.size(); ++i) {
    wchar_t c = u[i];
    if (c <= 0x20 || c >= 0x7f || c == L'"' || c == L'\\' || c == L'<' || c == L'>' || c == L'`') return false;
  }
  return true;
}

bool IsAbsoluteLocalPath(std::wstring const& p) {
  if (p.size() < 3 || p.size() > 260) return false;
  bool letter = (p[0] >= L'A' && p[0] <= L'Z') || (p[0] >= L'a' && p[0] <= L'z');
  if (!letter || p[1] != L':' || p[2] != L'\\') return false;
  for (wchar_t c : p) {
    if (c < 0x20 || c == L'<' || c == L'>' || c == L'"' || c == L'|' || c == L'?' || c == L'*') return false;
  }
  return true;
}

bool ParseIsoUtc(std::wstring const& iso, long long* out) {
  int y, mo, d, h, mi, s;
  if (swscanf_s(iso.c_str(), L"%4d-%2d-%2dT%2d:%2d:%2dZ", &y, &mo, &d, &h, &mi, &s) != 6) return false;
  std::tm tm{};
  tm.tm_year = y - 1900;
  tm.tm_mon = mo - 1;
  tm.tm_mday = d;
  tm.tm_hour = h;
  tm.tm_min = mi;
  tm.tm_sec = s;
  auto t = _mkgmtime64(&tm);
  if (t < 0) return false;
  *out = t;
  return true;
}

namespace {

constexpr size_t kMaxItems = 200;

bool Has(JsonObject const& o, wchar_t const* k, JsonValueType t) {
  return o.HasKey(k) && o.GetNamedValue(k).ValueType() == t;
}
std::wstring Str(JsonObject const& o, wchar_t const* k, size_t cap) {
  return Has(o, k, JsonValueType::String) ? CapText(o.GetNamedString(k).c_str(), cap) : L"";
}
bool Bool(JsonObject const& o, wchar_t const* k) { return Has(o, k, JsonValueType::Boolean) && o.GetNamedBoolean(k); }
long Num(JsonObject const& o, wchar_t const* k) {
  return Has(o, k, JsonValueType::Number) ? static_cast<long>(o.GetNamedNumber(k)) : 0;
}
std::wstring Url(JsonObject const& o) {
  auto u = Str(o, L"url", 400);
  return IsSafeGithubUrl(u) ? u : L"";
}
std::wstring Path(JsonObject const& o, wchar_t const* k) {
  auto p = Str(o, k, 300);
  return IsAbsoluteLocalPath(p) ? p : L"";
}

// Reads {status, failed[], items[]} and calls add() for each object item. Anything of the wrong shape is skipped.
template <class F>
Section ReadSection(JsonObject const& root, wchar_t const* key, F add) {
  Section s;
  if (!Has(root, key, JsonValueType::Object)) return s;
  auto sec = root.GetNamedObject(key);
  auto status = Str(sec, L"status", 20);
  if (status == L"signed_out" || status == L"offline" || status == L"error") s.status = status;
  if (Has(sec, L"failed", JsonValueType::Array)) {
    for (auto const& f : sec.GetNamedArray(L"failed")) {
      if (f.ValueType() != JsonValueType::Object) continue;
      auto fo = f.GetObject();
      s.failed.push_back({Str(fo, L"repo", 100), Str(fo, L"reason", 20)});
      if (s.failed.size() >= 50) break;
    }
  }
  if (Has(sec, L"items", JsonValueType::Array)) {
    size_t n = 0;
    for (auto const& it : sec.GetNamedArray(L"items")) {
      if (it.ValueType() != JsonValueType::Object) continue;
      add(it.GetObject());
      if (++n >= kMaxItems) break;
    }
  }
  return s;
}

}  // namespace

Loaded ParseSnapshot(std::wstring const& json) {
  Loaded r;
  try {
    JsonObject root{nullptr};
    if (!JsonObject::TryParse(json, root) || !Has(root, L"schema", JsonValueType::Number)) {
      r.state = Load::Corrupt;
      return r;
    }
    if (static_cast<int>(root.GetNamedNumber(L"schema")) > kSchema) {
      r.state = Load::NewerSchema;
      return r;
    }
    auto& s = r.snapshot;
    s.writtenAt = Str(root, L"writtenAt", 30);
    s.projectsSection = ReadSection(root, L"projects", [&](JsonObject const& o) {
      s.projects.push_back({Str(o, L"name", 60), Path(o, L"path"), Str(o, L"branch", 60), Str(o, L"lastOpened", 30),
                            Bool(o, L"dirty"), Bool(o, L"pinned")});
    });
    s.issuesSection = ReadSection(root, L"issues", [&](JsonObject const& o) {
      Issue i;
      i.repo = Str(o, L"repo", 100);
      i.title = Str(o, L"title", 120);
      i.url = Url(o);
      i.attention = Str(o, L"attention", 20);
      i.localPath = Path(o, L"localPath");
      i.assignee = Str(o, L"assignee", 40);
      i.number = Num(o, L"number");
      if (Has(o, L"labels", JsonValueType::Array)) {
        for (auto const& l : o.GetNamedArray(L"labels")) {
          if (l.ValueType() == JsonValueType::String && i.labels.size() < 5) i.labels.push_back(CapText(l.GetString().c_str(), 30));
        }
      }
      s.issues.push_back(std::move(i));
    });
    s.prsSection = ReadSection(root, L"prs", [&](JsonObject const& o) {
      Pr p;
      p.repo = Str(o, L"repo", 100);
      p.title = Str(o, L"title", 120);
      p.url = Url(o);
      p.author = Str(o, L"author", 40);
      p.review = Str(o, L"review", 20);
      p.checks = Str(o, L"checks", 20);
      p.conflict = Bool(o, L"conflict");
      p.localPath = Path(o, L"localPath");
      p.number = Num(o, L"number");
      s.prs.push_back(std::move(p));
    });
    r.state = Load::Ok;
  } catch (...) {
    r = Loaded{};
    r.state = Load::Corrupt;
  }
  return r;
}

Loaded LoadSnapshotFile(std::wstring const& path) {
  std::ifstream f(std::filesystem::path(path), std::ios::binary);
  Loaded l;
  if (!f) return l;  // Missing
  std::stringstream ss;
  ss << f.rdbuf();
  auto text = ss.str();
  if (text.starts_with("\xEF\xBB\xBF")) text.erase(0, 3);  // a BOM from an editor or PowerShell
  if (text.size() > 2 * 1024 * 1024) {
    l.state = Load::Corrupt;
    return l;
  }
  return ParseSnapshot(std::wstring(winrt::to_hstring(text).c_str()));
}

Loaded KeepLastGood(Loaded const& previous, Loaded fresh) {
  if (fresh.state == Load::Corrupt && previous.state == Load::Ok) return previous;
  return fresh;
}

}  // namespace null_widgets
