#!/bin/bash
set -e

# Create directories
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/lib"

# Add local path to PATH for current session
export PATH="$HOME/.local/bin:$PATH"

# 1. Download and install Node.js locally
echo "=== Installing Node.js locally ==="
NODE_VERSION="v22.12.0"
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    NODE_DIST="node-$NODE_VERSION-linux-x64"
elif [ "$ARCH" = "aarch64" ]; then
    NODE_DIST="node-$NODE_VERSION-linux-arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "Downloading Node.js $NODE_VERSION for $ARCH..."
curl -sS "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.xz" -o node.tar.xz
tar -xf node.tar.xz
rm node.tar.xz

# Move to ~/.local/lib/nodejs
mkdir -p "$HOME/.local/lib/nodejs"
rm -rf "$HOME/.local/lib/nodejs/$NODE_DIST"
mv "$NODE_DIST" "$HOME/.local/lib/nodejs/"

# Create symlinks in ~/.local/bin
ln -sf "$HOME/.local/lib/nodejs/$NODE_DIST/bin/node" "$HOME/.local/bin/node"
ln -sf "$HOME/.local/lib/nodejs/$NODE_DIST/bin/npm" "$HOME/.local/bin/npm"
ln -sf "$HOME/.local/lib/nodejs/$NODE_DIST/bin/npx" "$HOME/.local/bin/npx"

# 2. Install Python dependencies
echo "=== Installing Python dependencies ==="
pip install --user --break-system-packages fastapi uvicorn google-genai pydantic websockets python-multipart pytest

# Verify installations
echo "=== Verifying installations ==="
echo "pip version:"
pip --version || pip3 --version || echo "pip verify failed"
echo "node version:"
node -v || echo "node verify failed"
echo "npm version:"
npm -v || echo "npm verify failed"

echo "=== Bootstrapping complete! ==="
