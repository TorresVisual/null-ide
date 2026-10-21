# null_widgets.exe: the desktop widgets host (a plain Win32 exe: no package identity, no signing). Design: docs/specs/native-windows-widgets-design.md.
# Parsing, layout, placement and actions live in null_widget_core with no window or Direct2D calls, so CTest covers them.
# JSON comes from Windows.Data.Json (the C++/WinRT headers ship with the Windows SDK; nothing is downloaded).

set(CORE_SOURCES snapshot.cc layout.cc placement.cc)
set(TESTS snapshot_test layout_test placement_test)

add_library(null_widget_core STATIC ${CORE_SOURCES})
target_include_directories(null_widget_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_definitions(null_widget_core PUBLIC WIN32_LEAN_AND_MEAN UNICODE _UNICODE NOMINMAX)
target_compile_features(null_widget_core PUBLIC cxx_std_20)
if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
  target_compile_options(null_widget_core PUBLIC /Zc:__cplusplus /EHsc /W4 /permissive- /utf-8 /Qspectre /guard:cf)
endif()
target_link_libraries(null_widget_core PUBLIC windowsapp shell32)

foreach(t ${TESTS})
  add_executable(${t} ${t}.cc)
  target_link_libraries(${t} PRIVATE null_widget_core)
  target_compile_definitions(${t} PRIVATE FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")
  add_test(NAME ${t} COMMAND ${t})
endforeach()
