# Toolchain for building the plugin inside the compose stack, so a fresh clone
# needs nothing on the host but Docker: Node + Yarn 4 for the frontend bundle,
# Go + mage for the backend binary.
#
# Versions track .nvmrc / package.json `packageManager` / go.mod. GOTOOLCHAIN is
# left on `auto` so go.mod's exact patch release is fetched if the image lags.
FROM golang:1.26-bookworm AS go

FROM node:22-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}" \
    GOPATH=/go \
    GOCACHE=/go/build-cache \
    YARN_ENABLE_GLOBAL_CACHE=1 \
    YARN_GLOBAL_FOLDER=/yarn-cache
RUN corepack enable
WORKDIR /src
ENTRYPOINT ["/src/scripts/container-build.sh"]
