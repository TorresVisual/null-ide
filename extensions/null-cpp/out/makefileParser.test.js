"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const makefileParser_1 = require("./makefileParser");
const makeScaffoldContent_1 = require("./makeScaffoldContent");
const UNIVERSITY_MAKEFILE = `CXX           := clang++
CXXFLAGS      := -Wall -Wextra -pedantic -gdwarf-4 -std=c++20 -g -fstandalone-debug -c -o
ASSIGNMENT    := a2

BUILDDIR      := build
SOURCES       := $(wildcard *.cpp)
SOURCES_SUBD  := $(shell find */ -name "*.cpp")
DIRS          := $(patsubst %,$(BUILDDIR)/%,\${SOURCES_SUBD:.cpp=})
OBJECTS       := $(patsubst %,$(BUILDDIR)/%,\${SOURCES:.cpp=.o})
OBJECTS_SUBD  := $(patsubst %,$(BUILDDIR)/%,\${SOURCES_SUBD:.cpp=.o})


.DEFAULT_GOAL := default
.PHONY: default prepare clean bin all run test help

default: help

$(DIRS):
\tmkdir -p $@

prepare: $(DIRS)
\tmkdir -p $(BUILDDIR)

$(BUILDDIR)/%.o: %.cpp
\t@echo "compiling" $<
\t$(CXX) $(CXXFLAGS) $@ $< -MMD -MF ./$@.d

$(ASSIGNMENT) : $(OBJECTS) $(OBJECTS_SUBD)
\t@echo "linking" $@
\t$(CXX) -o $@ $^

clean:						## cleans up project folder
\trm -f $(ASSIGNMENT)

bin: prepare $(ASSIGNMENT)	## compiles project to executable binary
\tchmod +x $(ASSIGNMENT)

all: clean bin				## all of the above

run: all					## runs the project with default config
\t./$(ASSIGNMENT)

test: all					## runs public testcases on the project
\t./testrunner -c test.toml

help:						## prints the help text
\t@printf "Usage: make\\n"
`;
(0, node_test_1.test)('parseMakeTargets prefers ##-documented targets and excludes file/pattern rules', () => {
    const targets = (0, makefileParser_1.parseMakeTargets)(UNIVERSITY_MAKEFILE);
    assert.deepEqual(targets.map((t) => t.name), ['clean', 'bin', 'all', 'run', 'test', 'help']);
    assert.equal(targets.find((t) => t.name === 'run')?.description, 'runs the project with default config');
});
(0, node_test_1.test)('parseMakeTargets falls back to .PHONY targets when there are no ## comments', () => {
    const targets = (0, makefileParser_1.parseMakeTargets)((0, makeScaffoldContent_1.makefileContent)('MiniGit'));
    assert.deepEqual(targets.map((t) => t.name), ['all', 'run', 'clean']);
});
(0, node_test_1.test)('parseMakeTargets returns no targets for empty content', () => {
    assert.deepEqual((0, makefileParser_1.parseMakeTargets)(''), []);
});
//# sourceMappingURL=makefileParser.test.js.map