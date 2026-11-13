#!/usr/bin/make -f
# -*- makefile -*-

export DH_VERBOSE=1

%:
	dh $@

override_dh_strip_nondeterminism:
	dh_strip_nondeterminism --exclude=.png

# worksuite-ai (the Local AI service) is a Node single executable: its app is a blob injected into the
# ELF, and strip destroys it (the stripped binary segfaults at start, even with --version).
ifelse(M4_MEDIA_PLAYER, libvlc,
`# libVLC plugins are already stripped, and vlc/plugins/plugins.dat stores their sizes:
# stripping .comment again makes the cache stale
override_dh_strip:
	dh_strip --exclude=/vlc/plugins/ --exclude=/worksuite-ai

',
`override_dh_strip:
	dh_strip --exclude=/worksuite-ai

')dnl
override_dh_shlibdeps:
	dh_shlibdeps --no-act

DPKG_THREADS ?= $(shell n=$$(nproc); [ $$n -lt 4 ] && echo $$n || echo 4)

override_dh_builddeb:
	dh_builddeb -- -z9 -Zxz --threads-max=$(DPKG_THREADS)
