#include "placement.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/base.h>

using namespace winrt::Windows::Data::Json;

namespace null_widgets {

namespace {

constexpr int kMinDip = 200, kMaxDip = 800;

long long Overlap(Box const& a, Box const& b) {
  long long w = std::min(a.right, b.right) - std::max(a.left, b.left);
  long long h = std::min(a.bottom, b.bottom) - std::max(a.top, b.top);
  return (w > 0 && h > 0) ? w * h : 0;
}

long long CenterDistance2(Box const& a, Box const& b) {
  long long dx = (a.left + a.right) / 2 - (b.left + b.right) / 2;
  long long dy = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2;
  return dx * dx + dy * dy;
}

bool Number(JsonObject const& o, wchar_t const* k, int lo, int hi, int* out) {
  if (!o.HasKey(k) || o.GetNamedValue(k).ValueType() != JsonValueType::Number) return false;
  double d = o.GetNamedNumber(k);
  if (!(d >= lo && d <= hi)) return false;
  *out = static_cast<int>(d);
  return true;
}

}  // namespace

LayoutFile ParseLayout(std::wstring const& json) {
  LayoutFile out;
  try {
    JsonObject root{nullptr};
    if (!JsonObject::TryParse(json, root)) return out;
    if (root.HasKey(L"locked") && root.GetNamedValue(L"locked").ValueType() == JsonValueType::Boolean) out.locked = root.GetNamedBoolean(L"locked");
    if (!root.HasKey(L"widgets") || root.GetNamedValue(L"widgets").ValueType() != JsonValueType::Object) return out;
    auto widgets = root.GetNamedObject(L"widgets");
    for (int i = 0; i < kKindCount; ++i) {
      wchar_t const* key = KeyOf(static_cast<Kind>(i));
      if (!widgets.HasKey(key) || widgets.GetNamedValue(key).ValueType() != JsonValueType::Object) continue;
      auto o = widgets.GetNamedObject(key);
      Placement& p = out.widget[i];
      if (o.HasKey(L"visible") && o.GetNamedValue(L"visible").ValueType() == JsonValueType::Boolean) p.visible = o.GetNamedBoolean(L"visible");
      p.placed = Number(o, L"x", -100000, 100000, &p.x) & Number(o, L"y", -100000, 100000, &p.y);
      Number(o, L"w", kMinDip, kMaxDip, &p.w);
      Number(o, L"h", kMinDip, kMaxDip, &p.h);
    }
  } catch (...) {
    return LayoutFile{};
  }
  return out;
}

std::wstring SerializeLayout(LayoutFile const& layout) {
  JsonObject root, widgets;
  root.SetNamedValue(L"schema", JsonValue::CreateNumberValue(1));
  root.SetNamedValue(L"locked", JsonValue::CreateBooleanValue(layout.locked));
  for (int i = 0; i < kKindCount; ++i) {
    Placement const& p = layout.widget[i];
    JsonObject o;
    o.SetNamedValue(L"visible", JsonValue::CreateBooleanValue(p.visible));
    if (p.placed) {
      o.SetNamedValue(L"x", JsonValue::CreateNumberValue(p.x));
      o.SetNamedValue(L"y", JsonValue::CreateNumberValue(p.y));
    }
    if (p.w > 0) o.SetNamedValue(L"w", JsonValue::CreateNumberValue(p.w));
    if (p.h > 0) o.SetNamedValue(L"h", JsonValue::CreateNumberValue(p.h));
    widgets.SetNamedValue(KeyOf(static_cast<Kind>(i)), o);
  }
  root.SetNamedValue(L"widgets", widgets);
  return std::wstring(root.Stringify().c_str());
}

Box DefaultBox(Kind kind, Box work, double scale) {
  int gap = static_cast<int>(std::lround(16 * scale)), margin = static_cast<int>(std::lround(24 * scale));
  int y = work.top + margin;
  for (int i = 0; i < static_cast<int>(kind); ++i) {
    y += static_cast<int>(std::lround(DefaultSize(static_cast<Kind>(i)).h * scale)) + gap;
  }
  SizeDip d = DefaultSize(kind);
  int w = static_cast<int>(std::lround(d.w * scale)), h = static_cast<int>(std::lround(d.h * scale));
  int x = work.right - margin - w;
  return Box{x, y, x + w, y + h};
}

Box ClampToMonitors(Box r, std::vector<Box> const& work) {
  if (work.empty()) return r;
  Box const* best = &work[0];
  long long bestOverlap = -1, bestDist = 0;
  for (auto const& m : work) {
    long long o = Overlap(r, m), d = CenterDistance2(r, m);
    if (o > bestOverlap || (o == bestOverlap && o == 0 && d < bestDist)) {
      best = &m;
      bestOverlap = o;
      bestDist = d;
    }
  }
  int w = r.w(), h = r.h();
  int x = w <= best->w() ? std::clamp(r.left, best->left, best->right - w) : best->left;
  int y = h <= best->h() ? std::clamp(r.top, best->top, best->bottom - h) : best->top;
  return Box{x, y, x + w, y + h};
}

Box SnapToEdges(Box r, std::vector<Box> const& work, int threshold) {
  int w = r.w(), h = r.h();
  int bestDx = threshold + 1, bestDy = threshold + 1, x = r.left, y = r.top;
  for (auto const& m : work) {
    int candX[2] = {m.left, m.right - w}, candY[2] = {m.top, m.bottom - h};
    for (int c : candX) {
      if (std::abs(c - r.left) < bestDx) { bestDx = std::abs(c - r.left); x = c; }
    }
    for (int c : candY) {
      if (std::abs(c - r.top) < bestDy) { bestDy = std::abs(c - r.top); y = c; }
    }
  }
  if (bestDx > threshold) x = r.left;
  if (bestDy > threshold) y = r.top;
  return Box{x, y, x + w, y + h};
}

}  // namespace null_widgets
