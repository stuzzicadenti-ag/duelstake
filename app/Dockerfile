FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY src/ src/
ENV NODE_ENV=production PORT=4004
EXPOSE 4004
CMD ["node", "src/server.js"]
