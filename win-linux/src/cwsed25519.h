/*
 * (c) Copyright Ascensio System SIA 2010-2019
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
*/

#ifndef CWSED25519_H
#define CWSED25519_H

#include <cstddef>
#include <cstdint>

/*
 * WorkSuite Office: Ed25519 signature check (RFC 8032, verify only) of an update installer that the start
 * page downloads itself on Windows (CWsUpdateDownload). Same check as WinSparkle and Sparkle: the
 * appcast's sparkle:edSignature is the base64 Ed25519 signature over the whole file, against the
 * public key the app is built with (WS_EDDSA_PUBLIC_KEY).
 *
 * The message is hashed as it arrives (SHA-512 of R || A || M is streamed), so an installer of
 * hundreds of MB is never held in memory. Field arithmetic after TweetNaCl (public domain). Signatures
 * with S >= L are refused (no malleable signatures). No Qt, no OS calls: tested on Linux by
 * test/ed25519/ (build/check: `make -C win-linux/test/ed25519`).
 */
namespace WsEd25519
{
    class Verifier
    {
    public:
        /* sig: 64 bytes, publicKey: 32 bytes */
        Verifier(const uint8_t sig[64], const uint8_t publicKey[32]);
        void update(const uint8_t * data, size_t len);
        /* true only for a valid signature by that key over everything passed to update() */
        bool finish();

    private:
        uint8_t  m_sig[64];
        uint8_t  m_key[32];
        uint64_t m_state[8];
        uint8_t  m_block[128];
        size_t   m_used = 0;
        uint64_t m_total = 0;
        bool     m_done = false;

        void compress(const uint8_t * block);
    };

    /* one-shot form */
    bool verify(const uint8_t sig[64], const uint8_t publicKey[32], const uint8_t * msg, size_t len);
}

#endif // CWSED25519_H
