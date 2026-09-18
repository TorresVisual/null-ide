cmake_minimum_required(VERSION 3.20)
project(NullUpdater CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(null-updater WIN32
    src/main.cpp
    src/miniz.c
    src/miniz_tdef.c
    src/miniz_tinfl.c
    src/miniz_zip.c
)

target_compile_definitions(null-updater PRIVATE
    WIN32_LEAN_AND_MEAN
    _UNICODE
    UNICODE
    _CRT_SECURE_NO_DEPRECATE
    _CRT_NONSTDC_NO_DEPRECATE
    MINIZ_NO_TIME
)

target_compile_options(null-updater PRIVATE
    /EHsc
    /Ox
    /MT
)

target_link_libraries(null-updater PRIVATE
    winhttp
    shlwapi
    comctl32
    user32
    advapi32
    shell32
)
