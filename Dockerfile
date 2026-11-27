# 构建阶段：安装完整依赖并产出前端静态资源与编译后的服务端。
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.26.2
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN pnpm build

# 运行阶段：只保留生产依赖和构建产物，由 Fastify 同源提供页面与 API。
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@10.26.2
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
# 数据目录必须在镜像内先由 node 用户拥有，命名卷首次挂载时会继承该权限。
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
