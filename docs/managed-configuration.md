# WorkSuite Office: managed configuration (ADM-01, ADM-02, CLD-02)

An organisation can set some of WorkSuite Office's settings for everyone on a computer. A value
it sets is **locked**: the start page shows "*&lt;Organisation&gt;* manages WorkSuite Office on this
computer", lists it under **Settings your organisation set**, and the matching control in
Settings › WorkSuite (and Settings › General) can't be changed. A value it leaves out stays each
person's own choice.

There is one schema. The value names are the same on every platform.

| Name               | Type                         | Effect |
| ------------------ | ---------------------------- | ------ |
| `organization`     | string                       | The name in "*X* manages WorkSuite Office on this computer". |
| `server`           | string (`office.example.com` or `https://…`) | The WorkSuite server people sign in to. |
| `lockServer`       | bool (default **true** when `server` is set) | Sign-in goes to `server` only; "Use a different server" is hidden. |
| `allowOtherClouds` | bool (default **false**)     | Shows the bundled third-party clouds (Box, Dropbox, kDrive, Liferay, Moodle, Nextcloud, ownCloud, Seafile, Odoo). Without it they're hidden. |
| `updateChannel`    | `stable` \| `beta`           | The update channel. |
| `updateAuto`       | bool                         | Download and install updates automatically (true) or ask first (false). |
| `usageReports`     | bool                         | Usage and crash reports. |
| `aiFunctions`      | `all` \| `worksuite` \| `off`  | AI functions. `off` turns the AI switch off and locks it. |

Booleans can be written as `true`/`false`, `1`/`0`, or as a DWORD. An empty value means it's
not set.

## Windows: registry (Group Policy) or MSI properties

`HKEY_LOCAL_MACHINE\Software\Policies\WorkSuite\Office`, with string (REG_SZ) or DWORD values
using the names above:

```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\Software\Policies\WorkSuite\Office]
"organization"="Livezen Technologies"
"server"="office.livezen.lk"
"allowOtherClouds"=dword:00000000
"updateChannel"="stable"
"updateAuto"=dword:00000001
"usageReports"=dword:00000000
"aiFunctions"="worksuite"
```

The per-machine MSI writes the same key from these properties (ADM-02). Any property you leave
out is written empty, so it isn't set:

```bat
msiexec /i WorkSuiteOffice.msi /qn WS_ORGANIZATION="Livezen Technologies" WS_SERVER=office.livezen.lk ^
  WS_ALLOW_OTHER_CLOUDS=0 WS_UPDATE_CHANNEL=stable WS_UPDATE_AUTO=1 WS_USAGE_REPORTS=0 WS_AI_FUNCTIONS=worksuite
```

The properties are `WS_ORGANIZATION`, `WS_SERVER`, `WS_LOCK_SERVER`, `WS_ALLOW_OTHER_CLOUDS`,
`WS_UPDATE_CHANNEL`, `WS_UPDATE_AUTO`, `WS_USAGE_REPORTS` and `WS_AI_FUNCTIONS`
(`package/advinst/DesktopEditors.aip`).

## macOS: configuration profile

Use the payload type / preference domain `lk.worksuite.office` with the keys above. Only
values the profile *forces* count (managed preferences). A person's own `defaults write` is
not policy.

```xml
<dict>
  <key>PayloadType</key><string>lk.worksuite.office</string>
  <key>PayloadIdentifier</key><string>lk.livezen.worksuite-office.policy</string>
  <key>PayloadUUID</key><string>6C1F0C34-6E8B-4D5E-9E8B-0B9B9E3B3A11</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>organization</key><string>Livezen Technologies</string>
  <key>server</key><string>office.livezen.lk</string>
  <key>allowOtherClouds</key><false/>
  <key>updateChannel</key><string>stable</string>
  <key>updateAuto</key><true/>
  <key>usageReports</key><false/>
  <key>aiFunctions</key><string>worksuite</string>
</dict>
```

## Linux: `/etc/worksuite-office/policy.json`

The file is owned by root and readable by everyone (0644):

```json
{
  "organization": "Livezen Technologies",
  "server": "office.livezen.lk",
  "allowOtherClouds": false,
  "updateChannel": "stable",
  "updateAuto": true,
  "usageReports": false,
  "aiFunctions": "worksuite"
}
```

## How the app reads it

- Native: `CWorkSuite::policy()` (win-linux/src/cworksuite.cpp) and
  `-[ASCCommonViewController workSuitePolicy]` (macOS). They answer the start page's
  `worksuite:policy`. On Windows and Linux the update manager also applies `updateAuto` and
  `updateChannel` itself.
- Start page: `common/loginpage/src/worksuite/shell-logic.js` (`normalizePolicy`, tested by
  `npm test`) and `shell.js`.
