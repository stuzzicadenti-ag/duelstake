FROM node:22-alpine
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production && npm cache clean --force
COPY src/ src/
RUN mkdir -p /app/data/uploads && chown -R appuser:appgroup /app
USER appuser
ENV NODE_ENV=production PORT=4004
EXPOSE 4004
CMD ["node", "src/server.js"]
