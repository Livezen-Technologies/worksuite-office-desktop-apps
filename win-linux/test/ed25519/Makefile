# WorkSuite Office: the Ed25519 check of downloaded updates (win-linux/src/cwsed25519.cpp), on any OS with a C++ compiler
CXX ?= g++
test: test_ed25519
	./test_ed25519
test_ed25519: test_ed25519.cpp ../../src/cwsed25519.cpp ../../src/cwsed25519.h
	$(CXX) -std=c++11 -O2 -Wall -Wextra -o $@ test_ed25519.cpp ../../src/cwsed25519.cpp
clean:
	rm -f test_ed25519
.PHONY: test clean
