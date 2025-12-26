#!/bin/bash
set -e

# Amicii installer for Ubuntu/Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/user/amicii/main/install.sh | bash

REPO_URL="${AMICII_REPO_URL:-https://github.com/sebastiaanwouters/amicii.git}"
INSTALL_DIR="${AMICII_INSTALL_DIR:-$HOME/.local/share/amicii}"
BIN_DIR="${AMICII_BIN_DIR:-$HOME/.local/bin}"

echo "=== Amicii Installer ==="
echo

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Check for required tools
check_deps() {
    echo "Checking dependencies..."
    
    # Check for curl or wget
    if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
        error "curl or wget required"
    fi
    success "curl/wget available"
    
    # Check for git
    if ! command -v git &> /dev/null; then
        echo "Installing git..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y git
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y git
        elif command -v pacman &> /dev/null; then
            sudo pacman -S --noconfirm git
        else
            error "git required. Please install git manually."
        fi
    fi
    success "git available"
}

# Install Bun
install_bun() {
    if command -v bun &> /dev/null; then
        success "bun already installed: $(bun --version)"
        return
    fi
    
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    
    # Source bun for current session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    
    if command -v bun &> /dev/null; then
        success "bun installed: $(bun --version)"
    else
        error "Failed to install Bun"
    fi
}

# Install Amicii
install_amicii() {
    echo "Installing Amicii..."
    
    # Create directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BIN_DIR"
    
    # Clone or update repo
    if [ -d "$INSTALL_DIR/.git" ]; then
        echo "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull
    else
        echo "Cloning repository..."
        rm -rf "$INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    # Install dependencies
    echo "Installing dependencies..."
    bun install
    
    success "Amicii installed to $INSTALL_DIR"
}

# Create am command
create_command() {
    echo "Creating 'am' command..."
    
    # Create wrapper script
    cat > "$BIN_DIR/am" << EOF
#!/bin/bash
exec bun run "$INSTALL_DIR/src/index.ts" "\$@"
EOF
    
    chmod +x "$BIN_DIR/am"
    success "Created $BIN_DIR/am"
    
    # Check if BIN_DIR is in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        warn "$BIN_DIR is not in PATH"
        
        # Add to shell config
        SHELL_CONFIG=""
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_CONFIG="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_CONFIG="$HOME/.bashrc"
        fi
        
        if [ -n "$SHELL_CONFIG" ]; then
            if ! grep -q "export PATH=\"\$HOME/.local/bin:\$PATH\"" "$SHELL_CONFIG"; then
                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_CONFIG"
                success "Added $BIN_DIR to PATH in $SHELL_CONFIG"
                warn "Run 'source $SHELL_CONFIG' or start a new terminal"
            fi
        fi
    fi
}

# Initialize amicii
init_amicii() {
    echo "Initializing Amicii..."
    
    # Create config directory
    mkdir -p "$HOME/.amicii"
    
    # Create default config if not exists
    if [ ! -f "$HOME/.amicii/config.json" ]; then
        cat > "$HOME/.amicii/config.json" << EOF
{
  "port": 8765,
  "retention_days": 30
}
EOF
        success "Created default config at ~/.amicii/config.json"
    fi
}

# Print summary
print_summary() {
    echo
    echo "=== Installation Complete ==="
    echo
    echo "Amicii installed to: $INSTALL_DIR"
    echo "Command: $BIN_DIR/am"
    echo "Config: ~/.amicii/config.json"
    echo "Database: ~/.amicii/storage.sqlite"
    echo
    echo "Quick start:"
    echo "  am serve --daemon    # Start server"
    echo "  am agent register    # Get agent identity"
    echo "  am inbox             # Check messages"
    echo "  am --help            # Show all commands"
    echo
    
    # Check if PATH update needed
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        echo -e "${YELLOW}Note: Run 'source ~/.bashrc' or 'source ~/.zshrc' to use 'am' command${NC}"
        echo
    fi
}

# Main
main() {
    check_deps
    install_bun
    install_amicii
    create_command
    init_amicii
    print_summary
}

main
