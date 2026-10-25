# WorkSuite Office: CWsUpdateDownload against file:// sources. Needs Qt 6 (Core, Network), pkg-config and
# Python 3 with `cryptography`. MOC: Qt's moc (Debian/Ubuntu: /usr/lib/qt6/libexec/moc).
CXX ?= g++
MOC ?= /usr/lib/qt6/libexec/moc
QT := $(shell pkg-config --cflags --libs Qt6Core Qt6Network)
SRC := ../../src
test: test_updatedownload
	python3 gen.py data && WS_TEST_DATA=$(CURDIR)/data QT_QPA_PLATFORM=offscreen ./test_updatedownload
moc_cwsupdatedownload.cpp: $(SRC)/cwsupdatedownload.h
	$(MOC) $< -o $@
test_updatedownload: test_updatedownload.cpp moc_cwsupdatedownload.cpp $(SRC)/cwsupdatedownload.cpp $(SRC)/cwsed25519.cpp
	$(CXX) -std=c++17 -fPIC -Wall -Wextra -o $@ $^ $(QT)
clean:
	rm -rf test_updatedownload moc_cwsupdatedownload.cpp data
.PHONY: test clean
