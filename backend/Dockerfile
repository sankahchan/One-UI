FROM node:20-alpine

WORKDIR /app

# Needed for XRAY_DEPLOYMENT=docker: restart/hup/inspect xray container + exec config tests.
RUN apk add --no-cache docker-cli openssl bash

COPY package*.json ./
RUN npm install --include=dev --loglevel=error

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
