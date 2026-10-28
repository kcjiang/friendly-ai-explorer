FROM node:22-alpine

# 启用 pnpm
RUN npm install -g pnpm@9.15.9

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# 先复制依赖文件，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 复制源码
COPY . .

EXPOSE 3000

CMD ["pnpm", "dev"]
