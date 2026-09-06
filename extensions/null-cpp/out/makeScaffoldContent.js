"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makefileContent = makefileContent;
function makefileContent(projectName) {
    return `CXX := g++
CXXFLAGS := -std=c++20 -Wall -Wextra
SRC := $(wildcard src/*.cpp)
OBJ := $(SRC:src/%.cpp=build/%.o)
BIN := build/${projectName}

.PHONY: all run clean

all: $(BIN)

$(BIN): $(OBJ) | build
\t$(CXX) $(CXXFLAGS) -o $@ $(OBJ)

build/%.o: src/%.cpp | build
\t$(CXX) $(CXXFLAGS) -c -o $@ $<

build:
\tmkdir -p build

run: all
\t./$(BIN)

clean:
\trm -rf build
`;
}
//# sourceMappingURL=makeScaffoldContent.js.map