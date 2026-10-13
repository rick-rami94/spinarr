# ClusterFuzzLite build image for Spinarr's libFuzzer harnesses (SAFE-10).
#
# Base image pinned by digest (Pitfall 11 / D-16). Taken from tag
# gcr.io/oss-fuzz-base/base-builder:v1 on 2026-10-12. To bump:
#   docker pull gcr.io/oss-fuzz-base/base-builder:v1
#   docker inspect --format '{{index .RepoDigests 0}}' gcr.io/oss-fuzz-base/base-builder:v1
# then replace the digest below and re-run the local sanity check (plan 02-08).
FROM gcr.io/oss-fuzz-base/base-builder@sha256:1f9cf74bc3d7029b528494542f9d9851b256dceed38d3f420989434dc5ae0760

# apt packages come from the signed Ubuntu archive (documented exception to D-16).
RUN apt-get update && apt-get install -y --no-install-recommends ninja-build pkg-config xz-utils patch \
    && rm -rf /var/lib/apt/lists/*

# base-builder has no meson and Ubuntu 20.04's is older than the >= 0.60 these libraries need:
# reuse the hash-pinned engine build requirement.
COPY .github/requirements-build.txt /tmp/requirements-build.txt
RUN pip3 install --no-cache-dir --require-hashes -r /tmp/requirements-build.txt

COPY . $SRC/spinarr
WORKDIR $SRC/spinarr
COPY .clusterfuzzlite/build.sh $SRC/
