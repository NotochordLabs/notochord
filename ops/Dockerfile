# Runs the experiment's runner. The private key is passed at start, never built into the image.
# Mount a volume at /app/runner/state: it holds the populations and must survive restarts.
FROM node:22.23.4-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY runner ./runner
COPY data ./data
COPY protocol ./protocol
COPY ops/start.sh ./ops/start.sh
RUN mkdir -p runner/state && chown -R node:node runner/state
USER node
ENV NODE_ENV=production
HEALTHCHECK --interval=5m --timeout=60s --start-period=2m CMD sh -c 'test $(( $(date +%s) - $(date -r runner/state/$EXPERIMENT_NAME/heartbeat +%s) )) -lt 600'
CMD ["sh", "ops/start.sh"]
