# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/video-engine/package.json packages/video-engine/package.json
RUN npm install

FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=web

# Runtime minimo: solo l'output "standalone" di Next.js, niente devDependencies
# ne' sorgenti extra. Nessun processo di transcoding gira qui: l'unico lavoro
# del container e' servire l'app; decode/composizione/encode restano nel browser.
FROM base AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
