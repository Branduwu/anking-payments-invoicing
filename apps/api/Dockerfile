FROM node:24-alpine AS builder

WORKDIR /workspace/apps/api

COPY apps/api/package.json ./
RUN npm install

WORKDIR /workspace
COPY apps/api ./apps/api

WORKDIR /workspace/apps/api
RUN npm run prisma:generate
RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /workspace/apps/api

COPY --from=builder /workspace/apps/api/package.json ./package.json
COPY --from=builder /workspace/apps/api/node_modules ./node_modules
COPY --from=builder /workspace/apps/api/prisma ./prisma
COPY --from=builder /workspace/apps/api/dist ./dist

EXPOSE 4000

CMD ["npm", "run", "start"]
