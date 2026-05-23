# Stage 1 — build the Vue app
FROM node:20-alpine AS ui-builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

# Stage 2 — run the API + static server
FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY --from=ui-builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.js"]
