FROM node:24-slim

WORKDIR /app

COPY package.json ./
COPY server.mjs ./

ENV PORT=7860
EXPOSE 7860

CMD ["npm", "run", "start"]
