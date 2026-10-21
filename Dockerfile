# Truce: one Node process serving the API and the built web app.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY . .
RUN cd web && npm run build && cd .. && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data WEB_DIR=web/dist PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server/index.ts"]
