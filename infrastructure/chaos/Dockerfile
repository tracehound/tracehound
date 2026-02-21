FROM node:20-alpine

WORKDIR /app

# Install build tools for potential native bindings or gyp
RUN apk add --no-cache python3 make g++

# Copy workspace configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# We need to copy the packages to correctly install workspace dependencies
COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY infrastructure/ ./infrastructure/

# Install pnpm and dependencies
RUN npm install -g pnpm tsx
RUN pnpm install --frozen-lockfile

# Build workspace packages
RUN pnpm run build

# Expose the API port
EXPOSE 3000

# Run the test server
CMD ["tsx", "infrastructure/chaos/server.ts"]
