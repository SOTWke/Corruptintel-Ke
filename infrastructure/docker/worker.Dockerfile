FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ai/package.json packages/ai/package.json
RUN npm install --workspaces --if-present
COPY . .
WORKDIR /app/apps/worker
CMD ["npm", "run", "dev"]
