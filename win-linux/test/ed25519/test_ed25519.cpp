/*
 * WorkSuite Office: checks win-linux/src/cwsed25519.cpp (the Ed25519 check of a downloaded update) against
 * signatures made by OpenSSL (Python `cryptography`, RFC 8032 vectors 1 and 2 among them): each must verify
 * in one piece and streamed in odd chunks, and must fail with one bit changed in the message, the
 * signature or the key, with S + L (malleated), or with a message one byte longer. Run: make
 */
#include "../../src/cwsed25519.h"
#include <cstdio>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

static std::vector<uint8_t> hex(const std::string& s)
{
    std::vector<uint8_t> out;
    if (s == "-") return out;
    for (size_t i = 0; i + 1 < s.size(); i += 2) out.push_back(uint8_t(std::stoi(s.substr(i, 2), nullptr, 16)));
    return out;
}

static bool streamed(const std::vector<uint8_t>& sig, const std::vector<uint8_t>& pk, const std::vector<uint8_t>& m, size_t chunk)
{
    WsEd25519::Verifier v(sig.data(), pk.data());
    for (size_t i = 0; i < m.size(); i += chunk) v.update(m.data() + i, std::min(chunk, m.size() - i));
    return v.finish();
}

int main()
{
    std::ifstream in("vectors.txt");
    std::string line;
    int n = 0, bad = 0;
    auto check = [&](bool ok, const char * what) { if (!ok) { ++bad; std::printf("FAIL %d: %s\n", n, what); } };
    while (std::getline(in, line)) {
        std::istringstream ss(line);
        std::string a, b, c;
        ss >> a >> b >> c;
        auto pk = hex(a), sig = hex(b), m = hex(c);
        ++n;
        check(WsEd25519::verify(sig.data(), pk.data(), m.data(), m.size()), "valid signature");
        check(streamed(sig, pk, m, 1), "streamed by 1");
        check(streamed(sig, pk, m, 7), "streamed by 7");
        check(streamed(sig, pk, m, 128), "streamed by 128");
        if (!m.empty()) {
            auto m2 = m; m2[m2.size() / 2] ^= 0x10;
            check(!WsEd25519::verify(sig.data(), pk.data(), m2.data(), m2.size()), "changed message refused");
        }
        auto m3 = m; m3.push_back(0);
        check(!WsEd25519::verify(sig.data(), pk.data(), m3.data(), m3.size()), "longer message refused");
        for (int at : {0, 31, 32, 63}) {
            auto s2 = sig; s2[at] ^= 0x01;
            check(!WsEd25519::verify(s2.data(), pk.data(), m.data(), m.size()), "changed signature refused");
        }
        auto k2 = pk; k2[5] ^= 0x01;
        check(!WsEd25519::verify(sig.data(), k2.data(), m.data(), m.size()), "other key refused");
        // S + L: the same point equation holds, but RFC 8032 requires S < L
        static const uint8_t L[32] = {0xed,0xd3,0xf5,0x5c,0x1a,0x63,0x12,0x58,0xd6,0x9c,0xf7,0xa2,0xde,0xf9,0xde,0x14,
                                      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x10};
        auto s3 = sig; unsigned carry = 0;
        for (int i = 0; i < 32; ++i) { unsigned v = s3[32 + i] + L[i] + carry; s3[32 + i] = uint8_t(v); carry = v >> 8; }
        check(!WsEd25519::verify(s3.data(), pk.data(), m.data(), m.size()), "S + L refused");
    }
    std::vector<uint8_t> zero(64, 0), zk(32, 0);
    check(!WsEd25519::verify(zero.data(), zk.data(), nullptr, 0), "all-zero signature and key refused");
    std::printf("%d vectors, %d failures\n", n, bad);
    return (n >= 12 && bad == 0) ? 0 : 1;
}
