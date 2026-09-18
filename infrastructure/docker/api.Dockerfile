FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --workspaces --if-present
COPY . .
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "run", "dev"]
