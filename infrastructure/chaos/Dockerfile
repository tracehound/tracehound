FROM node:20.19.0-alpine3.21@sha256:8bda036ddd59ea51a23bc1a1035d3b5c614e72c01366d989f4120e8adca196d4

WORKDIR /app

# Install build tools for potential native bindings or gyp
RUN apk add --no-cache python3 make g++ procps

# Copy workspace configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# We need to copy the packages to correctly install workspace dependencies
COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY infrastructure/ ./infrastructure/

# Install pnpm from the repository-managed toolchain
RUN corepack enable
RUN pnpm install --frozen-lockfile

# Build workspace packages
RUN pnpm run build

ENV NODE_ENV=production

# Expose the API port
EXPOSE 3000

# Run the compiled chaos server
CMD ["node", "infrastructure/chaos/dist/server.js"]
