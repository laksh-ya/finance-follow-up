FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json ./
RUN npm install -g pnpm@9 && pnpm install --no-frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["pnpm", "dev"]
