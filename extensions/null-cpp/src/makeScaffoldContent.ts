export function makefileContent(projectName: string): string {
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
