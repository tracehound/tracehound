FROM node:20-alpine

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

# Run the test server
CMD ["pnpm", "exec", "tsx", "infrastructure/chaos/server.ts"]
