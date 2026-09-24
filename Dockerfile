# One image, one Railway service: the Bun web app and the Python model in the same
# container, talking over loopback. Splitting the model onto a GPU box later is an
# INFER_URL change rather than a rebuild.
FROM oven/bun:1.3.14-slim AS base
WORKDIR /app

# ---------------------------------------------------------------- JS deps --
FROM base AS deps
COPY package.json bun.lock* bunfig.toml ./
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/cutout/package.json packages/cutout/
COPY packages/db/package.json packages/db/
COPY packages/notify/package.json packages/notify/
COPY packages/payments/package.json packages/payments/
RUN bun install --frozen-lockfile || bun install

# ---------------------------------------------------------------- runtime --
FROM base AS runtime
ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    # rembg caches weights here; baked below so no deploy waits on a download.
    U2NET_HOME=/app/models \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

# A venv rather than --break-system-packages: Debian's python is also apt's, and
# pip writing into it is how an image stops being reproducible.
RUN python3 -m venv /opt/venv
COPY infer/requirements.txt /app/infer/requirements.txt
RUN pip install --no-cache-dir -r /app/infer/requirements.txt

# Bake the weights into the image.
#
# rembg otherwise downloads them from GitHub on first use, inside the first real
# request, on a container that has already told Railway it is healthy. That turns a
# cold start into a minute-long timeout and makes the deploy depend on GitHub being
# up at boot. Both baked models are permissively licensed (Apache-2.0); BiRefNet is
# MIT and better, but it is roughly a gigabyte and is fetched on demand instead --
# set INFER_HD_MODEL=birefnet-general once there is a GPU under this.
ARG BAKE_MODELS="u2net isnet-general-use"
RUN mkdir -p /app/models && \
    BAKE="$BAKE_MODELS" python3 -c "import os; from rembg import new_session; [new_session(m) for m in os.environ['BAKE'].split()]" \
    && ls -lh /app/models

# Copy the installed JS deps whole, not just /app/node_modules: Bun's isolated linker
# puts each workspace's dependencies in ITS OWN node_modules rather than hoisting, so
# copying only the root leaves every workspace import unresolvable. Listing the nested
# directories individually is not an option either -- a package with no dependencies
# has no node_modules at all and the COPY would fail.
COPY --from=deps /app /app
# .dockerignore excludes node_modules, so this overlays source without clobbering it.
COPY . .

# Railway injects PORT; the app reads it. Never hardcode one here or the edge proxy
# forwards to a closed socket while the container still reports healthy.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "apps/web/src/main.js"]
