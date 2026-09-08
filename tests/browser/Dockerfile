FROM oven/bun:1.3.8 AS bun
FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /work
