#!/usr/bin/env python3
"""Build the WorkSuite Office installer licence files.

Inputs (in this folder / next to it):
  TERMS.txt                    WorkSuite Office Terms of Use (UTF-8, the source of truth)
  ../opensource/LICENSE.txt    GNU AGPL-3.0, complete and unmodified

Outputs (committed, regenerate after editing TERMS.txt):
  TERMS.html                   the terms as HTML
  LICENSE.rtf                  terms (headings bold) followed by the complete AGPL-3.0;
                               the Inno Setup licence page (LicenseFile) shows it

Usage:
  python3 build.py            regenerate TERMS.html and LICENSE.rtf, then check them
  python3 build.py --check    only check that the committed files match the sources

The check parses LICENSE.rtf back to plain text and compares it with TERMS.txt + LICENSE.txt,
so the AGPL text is proven complete and unmodified.
"""
import html
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TERMS_TXT = HERE / "TERMS.txt"
AGPL_TXT = HERE.parent / "opensource" / "LICENSE.txt"
TERMS_HTML = HERE / "TERMS.html"
LICENSE_RTF = HERE / "LICENSE.rtf"

SECTION_RE = re.compile(r"^\d+\. \S.{0,78}$")


def read_lines(path):
    text = path.read_text(encoding="utf-8")
    if text.startswith("﻿"):
        text = text[1:]
    return text.replace("\r\n", "\n").rstrip("\n").split("\n")


def is_heading(index, line):
    return index == 0 or bool(SECTION_RE.match(line))


def rtf_escape(text):
    out = []
    for ch in text:
        code = ord(ch)
        if ch in "\\{}":
            out.append("\\" + ch)
        elif ch == "\t":
            out.append("\\tab ")
        elif 32 <= code < 128:
            out.append(ch)
        elif code < 32:
            raise ValueError("control character U+%04X in licence text" % code)
        else:
            # RTF \uN takes a signed 16-bit value; characters above the BMP go as surrogate pairs
            data = ch.encode("utf-16-le")
            for i in range(0, len(data), 2):
                unit = int.from_bytes(data[i:i + 2], "little")
                if unit > 32767:
                    unit -= 65536
                out.append("\\u%d?" % unit)
    return "".join(out)


def build_rtf(terms, agpl):
    parts = [
        "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1",
        "{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}{\\f1\\fmodern\\fcharset0 Courier New;}}",
        "\\viewkind4\\pard\\f0\\fs18",
    ]
    for i, line in enumerate(terms):
        body = rtf_escape(line)
        if is_heading(i, line) and line:
            body = "{\\b " + body + "}"
        parts.append(body + "\\par")
    parts.append("\\par")
    parts.append("\\f1\\fs16")
    for line in agpl:
        parts.append(rtf_escape(line) + "\\par")
    parts.append("}")
    return "\n".join(parts) + "\n"


def build_html(terms):
    out = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        "<title>%s</title>" % html.escape(terms[0]),
        "<style>body{font-family:Arial,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;"
        "line-height:1.5;color:#1b1f24}h1{font-size:1.4em}h2{font-size:1.1em;margin-top:1.4em}</style>",
        "</head>",
        "<body>",
    ]
    for i, line in enumerate(terms):
        if not line:
            continue
        esc = html.escape(line)
        esc = re.sub(r"(https?://[^\s<]+[^\s<.,;)])", r'<a href="\1">\1</a>', esc)
        esc = re.sub(r"([\w.+-]+@[\w-]+\.[\w.-]*\w)", r'<a href="mailto:\1">\1</a>', esc)
        if i == 0:
            out.append("<h1>%s</h1>" % esc)
        elif is_heading(i, line):
            out.append("<h2>%s</h2>" % esc)
        else:
            out.append("<p>%s</p>" % esc)
    out += ["</body>", "</html>"]
    return "\n".join(out) + "\n"


def rtf_to_text(rtf):
    """A small RTF reader: enough for the files build_rtf writes (and to catch escaping mistakes)."""
    out = []
    stack = []
    skip = False
    uc = 1
    pending_skip = 0
    i, n = 0, len(rtf)
    destinations = {"fonttbl", "colortbl", "stylesheet", "info", "*"}
    while i < n:
        ch = rtf[i]
        if ch == "{":
            stack.append((skip, uc))
            i += 1
        elif ch == "}":
            if not stack:
                raise ValueError("unbalanced } at offset %d" % i)
            skip, uc = stack.pop()
            i += 1
        elif ch == "\\":
            i += 1
            if i >= n:
                raise ValueError("dangling backslash")
            c = rtf[i]
            if c in "\\{}":
                if not skip:
                    out.append(c)
                i += 1
            elif c == "*":
                skip = True
                i += 1
            elif c == "\n" or c == "\r":
                if not skip:
                    out.append("\n")
                i += 1
            elif c.isalpha():
                m = re.compile(r"([a-zA-Z]{1,32})(-?\d{1,10})? ?").match(rtf, i)
                word, arg = m.group(1), m.group(2)
                i = m.end()
                if word in destinations:
                    skip = True
                elif skip:
                    pass
                elif word == "par" or word == "line":
                    out.append("\n")
                elif word == "tab":
                    out.append("\t")
                elif word == "uc":
                    uc = int(arg)
                elif word == "u":
                    unit = int(arg)
                    if unit < 0:
                        unit += 65536
                    out.append(chr(unit))
                    # skip the ANSI fallback characters
                    for _ in range(uc):
                        if i < n and rtf[i] not in "\\{}":
                            i += 1
            elif c == "'":
                if not skip:
                    out.append(bytes([int(rtf[i + 1:i + 3], 16)]).decode("cp1252"))
                i += 3
            else:
                raise ValueError("unknown control symbol \\%s at offset %d" % (c, i))
        elif ch in "\r\n":
            i += 1
        else:
            if not skip:
                if ord(ch) > 127:
                    raise ValueError("raw non-ASCII character at offset %d" % i)
                out.append(ch)
            i += 1
    if stack:
        raise ValueError("unbalanced {")
    text = "".join(out)
    # join UTF-16 surrogate pairs
    return text.encode("utf-16", "surrogatepass").decode("utf-16")


def expected_text(terms, agpl):
    return "\n".join(terms) + "\n\n" + "\n".join(agpl) + "\n"


def main():
    terms = read_lines(TERMS_TXT)
    agpl = read_lines(AGPL_TXT)
    if "--check" not in sys.argv[1:]:
        LICENSE_RTF.write_text(build_rtf(terms, agpl), encoding="ascii", newline="\r\n")
        TERMS_HTML.write_text(build_html(terms), encoding="utf-8", newline="\n")
    rtf = LICENSE_RTF.read_bytes().replace(b"\r\n", b"\n").decode("ascii")
    if not check(terms, agpl, rtf):
        sys.exit(1)
    print("OK: LICENSE.rtf parses back to TERMS.txt + the complete AGPL-3.0; TERMS.html is current")


def check(terms, agpl, rtf):
    ok = True
    sample = ["a \\ b { c } d", "caf\u00e9 \u2014 \u0dc3\u0dd2 \U0001f600"]
    if rtf_to_text(build_rtf(sample, ["x"])) != expected_text(sample, ["x"]):
        print("RTF escaping self-test failed", file=sys.stderr)
        ok = False
    if rtf != build_rtf(terms, agpl):
        print("LICENSE.rtf is out of date: run build.py", file=sys.stderr)
        ok = False
    parsed = rtf_to_text(rtf)
    want = expected_text(terms, agpl)
    if parsed != want:
        import difflib
        sys.stderr.writelines(difflib.unified_diff(want.splitlines(True), parsed.splitlines(True),
                                                   "expected", "LICENSE.rtf (parsed)"))
        ok = False
    if "\n".join(agpl) not in parsed:
        print("the AGPL-3.0 text in LICENSE.rtf is not complete", file=sys.stderr)
        ok = False
    if TERMS_HTML.read_text(encoding="utf-8") != build_html(terms):
        print("TERMS.html is out of date: run build.py", file=sys.stderr)
        ok = False
    return ok


if __name__ == "__main__":
    main()
