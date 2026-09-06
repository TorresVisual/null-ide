import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseMakeTargets } from './makefileParser';
import { makefileContent } from './makeScaffoldContent';

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

test('parseMakeTargets prefers ##-documented targets and excludes file/pattern rules', () => {
  const targets = parseMakeTargets(UNIVERSITY_MAKEFILE);
  assert.deepEqual(
    targets.map((t) => t.name),
    ['clean', 'bin', 'all', 'run', 'test', 'help']
  );
  assert.equal(targets.find((t) => t.name === 'run')?.description, 'runs the project with default config');
});

test('parseMakeTargets falls back to .PHONY targets when there are no ## comments', () => {
  const targets = parseMakeTargets(makefileContent('MiniGit'));
  assert.deepEqual(
    targets.map((t) => t.name),
    ['all', 'run', 'clean']
  );
});

test('parseMakeTargets returns no targets for empty content', () => {
  assert.deepEqual(parseMakeTargets(''), []);
});
