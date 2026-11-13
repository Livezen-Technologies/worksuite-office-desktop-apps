Name: %{_package_name}
Version: %{_product_version}
Release: %{_build_number}
Summary: Desktop editors for text docs, spreadsheets, presentations, PDFs, and PDF forms.
%if "%{_package_edition}" == "commercial"
License: Proprietary
%else
License: AGPLv3
%endif
Group: Applications/Office
URL: %{_publisher_url}
Vendor: %{_publisher_name}
Packager: %{_publisher_name} %{_support_mail}
AutoReq: no
AutoProv: no
Provides: %{_package_opensource}
%if "%{_package_edition}" == "commercial"
Conflicts: %{_package_opensource}
Obsoletes: %{_package_opensource}
%else
Conflicts: %{_package_commercial}
Obsoletes: %{_package_commercial}
%endif
Suggests: %{_package_opensource}-help

%description
Open-source office suite pack that comprises all the tools you need to
work offline with documents, spreadsheets, presentations, PDFs, and PDF forms.

%if "%{_company_name}" == "ONLYOFFICE"
%package help
Summary: Offline help for %{_company_name} %{_product_name}
BuildArch: noarch
Requires: %{_package_opensource}
Enhances: %{_package_opensource}

%description help
This package contains offline help files.
%endif

# worksuite-ai (the Local AI service) is a Node single executable: its app is a blob injected into the
# ELF, and strip destroys it (it segfaults at start, even with --version). brp-strip strips every ELF
# file whatever its mode, so strip goes through a wrapper that leaves worksuite-ai alone (written in
# %%install) and strips everything else as before.
%global __strip %{_builddir}/worksuite-strip

%prep
rm -rf "%{buildroot}"

%build

%install
mkdir -p "%{_builddir}"
printf '%%s\n' '#!/bin/sh' 'for a in "$@"; do f="$a"; done' 'case "$f" in */worksuite-ai) exit 0 ;; esac' 'exec /usr/bin/strip "$@"' > "%{_builddir}/worksuite-strip"
chmod 755 "%{_builddir}/worksuite-strip"
BUILD_DIR=../../../build
BIN_DIR=%{buildroot}%{_bindir}
DATA_DIR=%{buildroot}%{_datadir}
OPT_DIR=%{buildroot}/opt

mkdir -p %{buildroot}
cp -rt %{buildroot}/ $BUILD_DIR/main/*
echo "package = rpm" > $OPT_DIR/%{_desktopeditors_prefix}/converter/package.config

%if "%{_media_player}" == "libvlc"
# libVLC plugins are already stripped, and vlc/plugins/plugins.dat stores their sizes:
# without the exec bit brp-strip-comment-note leaves them untouched
find $OPT_DIR -path '*/vlc/plugins/*' -name '*.so' -type f -exec chmod 644 {} +
%endif

%if "%{_company_name}" == "ONLYOFFICE"
ln -srf $BIN_DIR/%{_desktopeditors_exec} $BIN_DIR/desktopeditors
cp -rt %{buildroot}/ $BUILD_DIR/help/*
%else
ETC_DIR=%{buildroot}%{_sysconfdir}
mkdir -p $ETC_DIR/%{_package_name}
# WorkSuite: the offline help ships in the main package
cp -rt %{buildroot}/ $BUILD_DIR/help/*
%endif

# WorkSuite: the Sinhala fonts for every app on the computer, not only the editors
mkdir -p $DATA_DIR/fonts
ln -s /opt/%{_desktopeditors_prefix}/fonts/worksuite-sinhala $DATA_DIR/fonts/worksuite-sinhala

%{?cc_license:cp %{_builddir}/../../../common/license/opensource/LICENSE-CC.txt \
    %{buildroot}%{_datadir}/licenses/%{_package_name}/LICENSE-CC.txt}

%clean
rm -rf "%{buildroot}"

%files
%attr(-, root, root) /opt/*
%attr(-, root, root) %{_datadir}/applications/*
%attr(-, root, root) %{_datadir}/doc/*
%attr(-, root, root) %{_datadir}/icons/*
%attr(-, root, root) %{_datadir}/fonts/worksuite-sinhala
%license %{_datadir}/licenses/%{_package_name}/LICENSE
%license %{_datadir}/licenses/%{_package_name}/3DPARTYLICENSE
%{?cc_license:%license %{_datadir}/licenses/%{_package_name}/LICENSE-CC.txt}
%attr(755, root, root) %{_bindir}/%{_desktopeditors_exec}
%if "%{_company_name}" == "ONLYOFFICE"
%attr(-, root, root) %{_bindir}/desktopeditors
%exclude /opt/%{_desktopeditors_prefix}/editors/web-apps/apps/*/main/resources/help
%else
# WorkSuite: no ImageViewer or VideoPlayer launcher is built (the Makefile defines neither
# _imageviewer_exec nor _videoplayer_exec, and rpmbuild stopped on them: no rpm was made)
%attr(-, root, root) %{_bindir}/%{_package_name}
%attr(777, root, root) %{_sysconfdir}/%{_package_name}
%endif

%if "%{_company_name}" == "ONLYOFFICE"
%files help
%defattr(-, root, root, -)
/opt/%{_desktopeditors_prefix}/editors/web-apps/apps/*/main/resources/help
%endif

%post
fc-cache -f >/dev/null 2>&1 || :

%postun
fc-cache -f >/dev/null 2>&1 || :
rm -f /usr/share/mime/packages/onlyoffice-docxf.xml
rm -f /usr/share/mime/packages/onlyoffice-oform.xml

%changelog

%include ../build/main/usr/share/doc/%{_package_name}/ChangeLog
