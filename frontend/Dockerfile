FROM node:20-alpine AS builder
WORKDIR /app
# Rewrites are baked in at build time: /api/* on the frontend is proxied to the backend container
ARG BACKEND_INTERNAL_URL=http://backend:5000
ARG NEXT_PUBLIC_API_URL=
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
