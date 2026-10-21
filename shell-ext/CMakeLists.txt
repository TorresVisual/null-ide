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
    src/preview_handler.cc
    src/explorer_command.def
    src/explorer_command.rc
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
    # Preview handler COM class GUID — registered via classic registry
    # (null-setup, setup/core/src/shell/), not AppxManifest.xml. See
    # docs/specs/explorer-preview-integration-design.md
    PREVIEW_HANDLER_UUID="58F3B583-5D67-489A-9069-97FD45B2569B"
    # Executable name (case-sensitive on some APIs)
    EXE_NAME="null.exe"
)

set_property(TARGET null_explorer_command PROPERTY CXX_STANDARD 17)
set_property(TARGET null_explorer_command PROPERTY CXX_STANDARD_REQUIRED ON)

if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
    # cl.exe or clang-cl.exe: MSVC-style slash flags
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
else()
    # plain clang.exe/gcc: GNU-style dash flags
    target_compile_options(null_explorer_command PRIVATE
        -Wall
        -Wextra
        -O2
    )
endif()

target_link_libraries(null_explorer_command PRIVATE
    advapi32
    runtimeobject
    shlwapi
    onecore
    # LaunchViaExplorer: CoCreateInstance / SysAllocString / shell interfaces
    ole32
    oleaut32
    shell32
)

# Never executed - exists only so AppxManifest.xml's <Application Executable>
# can point at something other than null.exe. See src/identity_stub.cc.
add_executable(null_identity_stub src/identity_stub.cc)
set_property(TARGET null_identity_stub PROPERTY CXX_STANDARD 17)
set_property(TARGET null_identity_stub PROPERTY CXX_STANDARD_REQUIRED ON)

enable_testing()
add_subdirectory(widgets)
