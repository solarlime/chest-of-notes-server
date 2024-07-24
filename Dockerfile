# Debian - for easier dependency installs
FROM node:20-bookworm AS build

RUN apt update && apt install -y ffmpeg \
    && groupadd -r app && useradd -rm -g app -G audio,video app

# The /app directory should act as the main application directory
WORKDIR /home/app

# Copy config files
COPY package.json yarn.lock ./

ARG yarn_version=3.6.4
ARG port
RUN echo "nodeLinker: node-modules" > .yarnrc.yml \
    && corepack enable \
    && yarn set version $yarn_version \
    && yarn install --immutable

COPY ./dist ./dist

EXPOSE $port

RUN chown -R app:app /home/app && chmod -R 777 /home/app

USER app

# Start the app using serve command
ENTRYPOINT [ "node", "/home/app/dist/index.js" ]
