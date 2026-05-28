cmake_minimum_required(VERSION 3.20)
project(NullExplorerCommand CXX)

# wil is a header-only library fetched by CI into deps/wil
set(WIL_INCLUDE "${CMAKE_CURRENT_SOURCE_DIR}/deps/wil/include")
if(NOT EXISTS "${WIL_INCLUDE}")
  message(FATAL_ERROR "wil headers not found at ${WIL_INCLUDE}. Run CI or: "
    "git clone https://github.com/microsoft/wil deps/wil")
endif()

add_library(null_explorer_command SHARED
    src/explorer_command.cc
    src/explorer_command.def
)

target_include_directories(null_explorer_command PRIVATE "${WIL_INCLUDE}")

target_compile_definitions(null_explorer_command PRIVATE
    _WINDLL
    WIN32_LEAN_AND_MEAN
    _UNICODE
    UNICODE
    _CRT_SECURE_NO_DEPRECATE
    _CRT_NONSTDC_NO_DEPRECATE
    # COM class GUID — must match AppxManifest.xml <com:Class Id>
    DLL_UUID="A72D088B-AC8B-4AB5-ABFE-49C5CE37A466"
    # Executable name (case-sensitive on some APIs)
    EXE_NAME="null.exe"
)

set_property(TARGET null_explorer_command PROPERTY CXX_STANDARD 17)
set_property(TARGET null_explorer_command PROPERTY CXX_STANDARD_REQUIRED ON)

target_compile_options(null_explorer_command PRIVATE
    /Zc:__cplusplus
    /EHsc
    /W4
    /Qspectre
    /guard:cf
    /Ox
)

target_link_options(null_explorer_command PRIVATE
    /guard:cf
    /OPT:REF
    /OPT:ICF
    /MACHINE:X64
)

target_link_libraries(null_explorer_command PRIVATE
    advapi32
    runtimeobject
    shlwapi
    onecore
)
