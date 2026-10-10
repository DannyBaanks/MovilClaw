# The sandbox image. Deliberately tiny: the less a sandbox contains, the less there is
# to attack. Python is included because the isolation tests use it to try to escape.
FROM alpine:3.20

RUN apk add --no-cache python3

# A non-root user that matches the --user flag the orchestrator passes.
RUN adduser -D -u 1000 sandbox && mkdir -p /work && chown -R sandbox:sandbox /work

USER sandbox
WORKDIR /work

# The orchestrator overrides this with its own entrypoint; it exists so the image
# is runnable on its own for manual checks.
CMD ["/bin/sh", "-c", "sleep infinity"]
