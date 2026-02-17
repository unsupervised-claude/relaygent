# Relaygent Docker image — Node 22 + Python 3.12 + Claude CLI
# Runs the relay harness, hub, forum, and notifications services.
# Computer-use available headless via Xvfb + xdotool (no Hammerspoon).

FROM node:22-bookworm-slim AS base

# System deps: Python, git, computer-use tools, Xvfb for headless GUI
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip python3-gi \
    git curl \
    xdotool scrot wmctrl imagemagick xvfb \
    at-spi2-core python3-pyatspi gir1.2-atspi-2.0 \
    && rm -rf /var/lib/apt/lists/*

# Claude CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy package files first for layer caching
COPY hub/package.json hub/
COPY notifications/package.json notifications/
COPY computer-use/package.json computer-use/
COPY email/package.json email/
COPY slack/package.json slack/

# Install Node deps
RUN cd hub && npm install && cd .. \
    && cd notifications && npm install && cd .. \
    && cd computer-use && npm install && cd .. \
    && cd email && npm install && cd .. \
    && cd slack && npm install

# Python venvs for forum + notifications
COPY forum/requirements.txt forum/
COPY notifications/requirements.txt notifications/
RUN python3 -m venv forum/.venv \
    && forum/.venv/bin/pip install -q -r forum/requirements.txt \
    && python3 -m venv notifications/.venv \
    && notifications/.venv/bin/pip install -q -r notifications/requirements.txt

# Copy everything else
COPY . .

# Build the hub
RUN cd hub && npm run build

# Create directories for runtime data
RUN mkdir -p knowledge/topics logs data

# Copy KB templates if not already present
RUN for f in handoff.md working-state.md intent.md tasks.md curiosities.md dead-ends.md; do \
        [ -f "knowledge/topics/$f" ] || cp "templates/$f" "knowledge/topics/$f"; \
    done

# Init KB git repo if needed
RUN cd knowledge && \
    ([ -d .git ] || (git init && git config user.name "relaygent" && \
     git config user.email "relaygent@localhost" && git add -A && \
     git commit -m "Initial KB"))

# Expose service ports
EXPOSE 8080 8083 8085 8097

# Entrypoint runs the startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["start"]
