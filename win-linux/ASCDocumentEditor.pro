
TARGET = DesktopEditors
DESTDIR = $$PWD

include(defaults.pri)

INCLUDEPATH += $$PWD/src/prop \
                $$PWD/src

HEADERS += \
    #src/prop/csplash_p.h \
    src/prop/defines_p.h \
    src/prop/cascapplicationmanagerwrapperintf.h \
    src/prop/version_p.h

SOURCES += \
    src/prop/cmainwindowimpl.cpp \
    src/prop/utils.cpp

#DEFINES += _GLIBCXX_USE_CXX11_ABI=0
DEFINES += __DONT_WRITE_IN_APP_TITLE
DEFINES += APP_ICON_PATH=\"./res/icons/desktopeditors.ico\"

message($$PLATFORM_BUILD)

#win32 {
    updmodule:!build_xp {
        DEFINES += _UPDMODULE
        message(updates is turned on)
    }
#}

# WorkSuite (UPD-04, G-02): self-update through WinSparkle when CI gives the appcast and WinSparkle
# (build-windows-v10.yml). Without them (local builds) nothing changes and no update code is compiled in.
win32 {
    WS_APPCAST = $$(WS_UPDATE_APPCAST_URL)
    WS_SPARKLE = $$(WINSPARKLE_DIR)
    !isEmpty(WS_APPCAST):!isEmpty(WS_SPARKLE) {
        DEFINES += WS_WINSPARKLE WS_APPCAST_URL=\\\"$$WS_APPCAST\\\" \
                   WS_EDDSA_PUBLIC_KEY=\\\"$$(WS_UPDATE_EDDSA_PUBLIC_KEY)\\\" WS_BUILD_NUMBER=\\\"$$(BUILD_NUMBER)\\\"
        INCLUDEPATH += $$WS_SPARKLE/include
        LIBS += -L$$WS_SPARKLE/x64/Release -lWinSparkle -lversion
        # the upstream update service (updatesvc, ONLYOFFICE's JSON feed) is not used
        DEFINES -= _UPDMODULE
        HEADERS -= $$PWD/src/cupdatemanager.h
        SOURCES -= $$PWD/src/cupdatemanager.cpp
        message(WorkSuite updates through WinSparkle: $$WS_APPCAST)
    }
}

!disable_addon_mode {
    ENV_URL_APPCAST_MAIN = $$(DESKTOP_URL_UPDATES_MAIN_CHANNEL)
    !isEmpty(ENV_URL_APPCAST_MAIN) {
        DEFINES += URL_APPCAST_UPDATES=\\\"$${ENV_URL_APPCAST_MAIN}\\\"
    }

    ENV_URL_APPCAST_DEV = $$(DESKTOP_URL_UPDATES_DEV_CHANNEL)
    !isEmpty(ENV_URL_APPCAST_DEV) {
        DEFINES += URL_APPCAST_DEV_CHANNEL=\\\"$${ENV_URL_APPCAST_DEV}\\\"
    }

    message(appcast url: $$ENV_URL_APPCAST_MAIN)
    message(appcast dev url: $$ENV_URL_APPCAST_DEV)
}

core_windows {
    RC_FILE = $$PWD/version.rc
    OTHER_FILES += $$PWD/version.rc
}

core_linux {
    GLIB_RESOURCE_FILES += $$PWD/res/gresource.xml

    glib_resources.name = gresource
    glib_resources.input = GLIB_RESOURCE_FILES
    glib_resources.output = $$PWD/res/${QMAKE_FILE_IN_BASE}.c
    glib_resources.commands = glib-compile-resources --target ${QMAKE_FILE_OUT} --sourcedir ${QMAKE_FILE_IN_PATH} --generate-source ${QMAKE_FILE_IN}
    glib_resources.variable_out = SOURCES
    QMAKE_EXTRA_COMPILERS += glib_resources
}

HEADERS += \
    src/prop/cmainwindowimpl.h
