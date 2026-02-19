FROM node:20-alpine

WORKDIR /app

# Needed for XRAY_DEPLOYMENT=docker: restart/hup/inspect xray container + exec config tests.
RUN apk add --no-cache docker-cli openssl bash curl \
    && curl -SL https://github.com/docker/compose/releases/download/v2.29.1/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

COPY package*.json ./
RUN npm install --include=dev --loglevel=error

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
