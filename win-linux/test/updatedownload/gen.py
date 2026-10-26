# WorkSuite Office: test data for test_updatedownload (an installer, its Ed25519 signature, appcasts)
import base64, os, sys
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization as s

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
raw = lambda k: k.public_key().public_bytes(s.Encoding.Raw, s.PublicFormat.Raw)
key, other = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
data = os.urandom(3 * 1024 * 1024 + 17)
open(f"{out}/installer.exe", "wb").write(data)
sig = base64.b64encode(key.sign(data)).decode()
open(f"{out}/installer.sig", "w").write(sig)
open(f"{out}/key.pub", "w").write(base64.b64encode(raw(key)).decode())
url = "file://" + os.path.abspath(f"{out}/installer.exe")
bad = bytearray(key.sign(data)); bad[10] ^= 1

def appcast(name, enclosure):
    open(f"{out}/{name}", "w").write(f"""<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
<channel><title>WorkSuite Office</title>
<item><title>9.3.2</title><sparkle:version>1110</sparkle:version>
  <enclosure url="{url}" length="{len(data)}" type="application/octet-stream" sparkle:os="windows" sparkle:edSignature="{sig}"/></item>
<item><title>9.3.3</title><sparkle:version>1120</sparkle:version><sparkle:shortVersionString>9.3.3</sparkle:shortVersionString>
  <enclosure {enclosure} type="application/octet-stream" sparkle:os="windows"/></item>
<item><title>mac</title><sparkle:version>1200</sparkle:version>
  <enclosure url="file:///nowhere.dmg" length="1" sparkle:os="macos" sparkle:edSignature="{sig}"/></item>
</channel></rss>""")

appcast("good.xml", f'url="{url}" length="{len(data)}" sparkle:edSignature="{sig}"')
appcast("unsigned.xml", f'url="{url}" length="{len(data)}"')
appcast("badsig.xml", f'url="{url}" length="{len(data)}" sparkle:edSignature="{base64.b64encode(bytes(bad)).decode()}"')
appcast("otherkey.xml", f'url="{url}" length="{len(data)}" sparkle:edSignature="{base64.b64encode(other.sign(data)).decode()}"')
appcast("short.xml", f'url="{url}" length="{len(data) - 1}" sparkle:edSignature="{sig}"')
appcast("long.xml", f'url="{url}" length="{len(data) + 1}" sparkle:edSignature="{sig}"')
appcast("nolength.xml", f'url="{url}" sparkle:edSignature="{sig}"')
