FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
# No native bigint-buffer addon: SDK uses its JavaScript implementation.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY automation ./automation
COPY src/solana-wire.js ./src/solana-wire.js
USER node
CMD ["node", "automation/runner.mjs"]
