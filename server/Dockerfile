# Build the browser and run the room/signaling/relay server as one release.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG RELEASE_ID=development
ENV RELEASE_ID=$RELEASE_ID
ENV BASE_PATH=/
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared

EXPOSE 8080
CMD ["node", "--import", "tsx", "server/main.ts"]
