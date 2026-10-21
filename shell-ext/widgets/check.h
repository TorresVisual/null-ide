#pragma once
// A framework-free check macro for the widget tests. Each *_test.cc has its own main() and is one CTest test.
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include <winrt/base.h>

inline int g_failures = 0;

#define CHECK(c)                                                        \
  do {                                                                  \
    if (!(c)) {                                                         \
      ++g_failures;                                                     \
      std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " << #c << "\n"; \
    }                                                                   \
  } while (0)

// Fixtures are UTF-8 files next to the sources (FIXTURE_DIR is set by CMake).
inline std::wstring ReadFixture(char const* name) {
  std::ifstream f(std::string(FIXTURE_DIR) + "/" + name, std::ios::binary);
  std::stringstream ss;
  ss << f.rdbuf();
  return std::wstring(winrt::to_hstring(ss.str()).c_str());
}

inline int Finish(char const* what) {
  if (g_failures) {
    std::cerr << g_failures << " check(s) failed in " << what << "\n";
    return 1;
  }
  std::cout << what << ": all checks passed\n";
  return 0;
}
