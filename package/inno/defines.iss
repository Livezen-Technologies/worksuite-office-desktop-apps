; -- WorkSuite Office Defines --

#define sCompanyName                    "WorkSuite"
#define sIntCompanyName                 sCompanyName
#define sProductName                    "Office"
#define sIntProductName                 "DesktopEditors"
#define sAppName                        str(sCompanyName + " " + sProductName)
#define sPackageName                    str(sIntCompanyName + "-" + sIntProductName)
#define sAppPublisher                   "Livezen Technologies LLC"
#define sAppPublisherURL                "https://worksuitecloud.com/"
#define sAppSupportURL                  "https://worksuitecloud.com/"
#define sAppCopyright                   str("© Ascensio System SIA and contributors, " + sAppPublisher + " " + GetDateTimeString("yyyy",,))
#define sAppIconName                    "WorkSuite Office"
#define sOldAppIconName                 "WorkSuite Editors"
#define sAppProtocol                    'oo-office'
#define sWorkSuiteProtocol              'worksuiteoffice'

#define APP_PATH                        str(sIntCompanyName + "\" + sIntProductName)
#define UPD_PATH                        str(sIntProductName + "Updates")
#define APP_REG_PATH                    str("Software\" + APP_PATH)
#define APP_REG_UNINST_KEY              str(sCompanyName + " " + sProductName)
#define APP_USER_MODEL_ID               "ASC.Documents.5"
#define APP_MUTEX_NAME                  "TEAMLAB"
#define APPWND_CLASS_NAME               "DocEditorsWindowClass"

#define iconsExe                        "DesktopEditors.exe"
#define NAME_EXE_OUT                    "editors.exe"

#define ASSC_APP_NAME                   "WorkSuite Office"
#define ASCC_REG_PREFIX                 "ASC"
#define ASCC_REG_REGISTERED_APP_NAME    "WorkSuite Office"
#define ASSOC_PROG_ID                   "ASC.Editors"
#define ASSOC_APP_FRIENDLY_NAME         "WorkSuite Office"

#dim FA_ARR[61] { \
  "csv", \
  "djvu", \
  "doc", \
  "docm", \
  "docx", \
  "dot", \
  "dotm", \
  "dotx", \
  "dps", \
  "dpt", \
  "epub", \
  "fb2", \
  "fodp", \
  "fods", \
  "fodt", \
  "hwp", \
  "hwpx", \
  "key", \
  "md", \
  "numbers", \
  "odg", \
  "odp", \
  "ods", \
  "odt", \
  "otp", \
  "ots", \
  "ott", \
  "oxps", \
  "pages", \
  "pdf", \
  "pot", \
  "potm", \
  "potx", \
  "pps", \
  "ppsm", \
  "ppsx", \
  "ppt", \
  "pptm", \
  "pptx", \
  "rtf", \
  "stw", \
  "sxc", \
  "sxi", \
  "sxw", \
  "tsv", \
  "vsdm", \
  "vsdx", \
  "vssm", \
  "vssx", \
  "vstm", \
  "vstx", \
  "wps", \
  "wpt", \
  "xls", \
  "xlsb", \
  "xlsm", \
  "xlsx", \
  "xlt", \
  "xltm", \
  "xltx", \
  "xps" \
}

#dim SN_ARR[4] { \
  "docx", \
  "xlsx", \
  "pptx", \
  "pdf" \
}
