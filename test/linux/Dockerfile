# Linux test environment: builds the engine, generates fixtures and runs every test suite,
# including the real app under Xvfb with the bubblewrap sandbox. See test/linux/run.sh.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ninja-build nasm pkg-config curl ca-certificates patch xz-utils python3-pip rsync git \
      ffmpeg dvdauthor genisoimage fonts-dejavu-core cmake libfreetype-dev zlib1g-dev \
      bubblewrap xvfb xauth dbus-x11 libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxshmfence1 \
      libdrm2 libatk-bridge2.0-0 libcups2 libx11-xcb1 libxkbcommon0 \
    && pip3 install --no-cache-dir 'meson>=1.3' \
    && rm -rf /var/lib/apt/lists/*
ARG NODE=22.20.0
RUN arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
    && curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-$arch.tar.xz" | tar xJ -C /usr/local --strip-components=1
RUN useradd -m dev
USER dev
WORKDIR /home/dev/spinarr
