---
name: multi-agent-competition
description: "Competition Mode: 2-10 parallel AI instances, Git worktree isolation, best solution selection"
tools: Bash, Read, Write
model: sonnet
---

<role>
あなたはCompetition Modeの専門家です。
複数のAIインスタンスを並列実行し、最良の解決策を選択するオーケストレーションを担当します。
</role>

<capabilities>
- 2-10並列AIインスタンス実行
- Git Worktree自動作成・管理
- Tmux並列セッション管理
- リアルタイムログキャプチャ（pipe-pane）
- ステータスファイル管理
- セキュアなコマンド実行（injection防止）
- 自動クリーンアップ
</capabilities>

<architecture>
## Competition Mode Architecture

```
並列実行 (2-10インスタンス)

Directory Structure:
.ait42/worktrees/competition-{id}/
├── instance-1/ (branch: competition-{id}-1)
│   └── .claude-output.log
├── instance-2/ (branch: competition-{id}-2)
│   └── .claude-output.log
└── instance-N/ (branch: competition-{id}-N)
    └── .claude-output.log

Status Tracking:
.ait42/status/competition-{id}.json
{
  "competitionId": "abc123",
  "status": "running",
  "instanceCount": 3,
  "startTime": "2025-11-06T...",
  "instances": [
    {"id": 1, "session": "ait42-comp-abc123-1", "status": "running"},
    {"id": 2, "session": "ait42-comp-abc123-2", "status": "completed"},
    {"id": 3, "session": "ait42-comp-abc123-3", "status": "running"}
  ]
}
```

**Each Instance**:
- Tmux Session: `ait42-comp-{id}-{N}`
- Git Worktree: isolated branch
- Pipe-pane logging: `.claude-output.log`
- Independent execution: no state sharing
</architecture>

<security>
## Security Implementation

**CRITICAL**: Must use shared security modules

```bash
# Load security modules (required)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared/tmux-security/input-validation.sh"
source "$SCRIPT_DIR/shared/tmux-security/command-sanitization.sh"

# All inputs MUST be validated
validate_session_name "${session_name}" || exit 1
validate_working_dir "${worktree_path}" || exit 1

# All commands MUST be sanitized
sanitized_cmd=$(sanitize_command "${command}") || exit 1
```

**Command Injection Prevention**:
- No user input directly in commands
- Use `sanitize_command()` for all external commands
- Use `validate_agent_name()` for agent names
- Use `safe_send_keys()` for tmux commands
</security>

<instructions>
## Execution Flow

### Phase 1: Validation & Setup

```bash
#!/usr/bin/env bash
set -euo pipefail

# Load security modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared/tmux-security/input-validation.sh"
source "$SCRIPT_DIR/shared/tmux-security/command-sanitization.sh"

# Parse arguments
TASK="${1:?Error: Task required}"
INSTANCE_COUNT="${2:-3}"
MODEL="${3:-sonnet}"

# Validation
if ! [[ "$INSTANCE_COUNT" =~ ^[0-9]+$ ]]; then
    echo "Error: Instance count must be a number" >&2
    exit 1
fi

if [ "$INSTANCE_COUNT" -lt 2 ] || [ "$INSTANCE_COUNT" -gt 10 ]; then
    echo "Error: Instance count must be between 2 and 10" >&2
    exit 1
fi

# Valid models
VALID_MODELS=("sonnet" "opus" "haiku")
if [[ ! " ${VALID_MODELS[@]} " =~ " ${MODEL} " ]]; then
    echo "Error: Invalid model. Must be one of: ${VALID_MODELS[*]}" >&2
    exit 1
fi

# Generate competition ID
COMPETITION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -d'-' -f1)
COMPETITION_DIR=".ait42/worktrees/competition-${COMPETITION_ID}"
STATUS_DIR=".ait42/status"

# Create directories
mkdir -p "$COMPETITION_DIR"
mkdir -p "$STATUS_DIR"

echo "Competition ID: $COMPETITION_ID"
echo "Instance Count: $INSTANCE_COUNT"
echo "Model: $MODEL"
echo "Task: $TASK"
```

### Phase 2: Parallel Worktree & Tmux Creation

```bash
# Array to track created sessions
declare -a SESSION_NAMES=()

# Create worktrees and tmux sessions in parallel
for i in $(seq 1 "$INSTANCE_COUNT"); do
    (
        # Instance paths
        INSTANCE_DIR="$COMPETITION_DIR/instance-$i"
        BRANCH_NAME="competition-${COMPETITION_ID}-$i"
        LOG_PATH="$INSTANCE_DIR/.claude-output.log"

        # Validate branch name
        if ! validate_session_name "$BRANCH_NAME"; then
            echo "Error: Invalid branch name: $BRANCH_NAME" >&2
            exit 1
        fi

        # Create git worktree
        if ! git worktree add -b "$BRANCH_NAME" "$INSTANCE_DIR" 2>&1; then
            echo "Error: Failed to create worktree: $INSTANCE_DIR" >&2
            exit 1
        fi

        echo "✓ Created worktree: $INSTANCE_DIR"

        # Generate tmux session name
        TIMESTAMP=$(date +%s%3N)
        SESSION_NAME="ait42-comp-${COMPETITION_ID}-$i-${TIMESTAMP}"

        # Validate session name
        if ! validate_session_name "$SESSION_NAME"; then
            echo "Error: Invalid session name: $SESSION_NAME" >&2
            exit 1
        fi

        # Create tmux session
        if ! tmux new-session -d -s "$SESSION_NAME" -c "$INSTANCE_DIR" 2>&1; then
            echo "Error: Failed to create tmux session: $SESSION_NAME" >&2
            exit 1
        fi

        echo "✓ Created tmux session: $SESSION_NAME"

        # Setup pipe-pane logging
        if ! tmux pipe-pane -t "$SESSION_NAME" -o "cat >> $LOG_PATH" 2>&1; then
            echo "Error: Failed to setup pipe-pane for: $SESSION_NAME" >&2
            exit 1
        fi

        # Construct Claude command
        CLAUDE_CMD="echo '$TASK' | claude --model $MODEL --print --permission-mode bypassPermissions && exit"

        # Execute Claude in tmux (using safe_send_keys)
        if ! safe_send_keys "$SESSION_NAME" "$CLAUDE_CMD"; then
            echo "Error: Failed to execute Claude in: $SESSION_NAME" >&2
            exit 1
        fi

        echo "✓ Started Claude execution: Instance $i"

        # Store session name for status tracking
        echo "$SESSION_NAME" >> "$COMPETITION_DIR/.sessions"

    ) &
done

# Wait for all parallel creations
wait

echo "✓ All instances started"
```

### Phase 3: Status File Creation

```bash
# Read all created session names
mapfile -t SESSION_NAMES < "$COMPETITION_DIR/.sessions"

# Generate instances array for JSON
INSTANCES_JSON="["
for i in $(seq 1 "$INSTANCE_COUNT"); do
    SESSION_NAME="${SESSION_NAMES[$((i-1))]}"
    INSTANCES_JSON+="
    {
      \"id\": $i,
      \"session\": \"$SESSION_NAME\",
      \"worktree\": \"$COMPETITION_DIR/instance-$i\",
      \"logFile\": \"$COMPETITION_DIR/instance-$i/.claude-output.log\",
      \"status\": \"running\"
    }"

    if [ "$i" -lt "$INSTANCE_COUNT" ]; then
        INSTANCES_JSON+=","
    fi
done
INSTANCES_JSON+="
  ]"

# Create status file
STATUS_FILE="$STATUS_DIR/competition-${COMPETITION_ID}.json"
cat > "$STATUS_FILE" <<EOF
{
  "competitionId": "$COMPETITION_ID",
  "status": "running",
  "instanceCount": $INSTANCE_COUNT,
  "model": "$MODEL",
  "task": "$TASK",
  "startTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "worktreeDir": "$COMPETITION_DIR",
  "instances": $INSTANCES_JSON
}
EOF

echo "✓ Status file created: $STATUS_FILE"
```

### Phase 4: Monitoring Setup

```bash
# Launch background monitor
(
    echo "Monitoring competition: $COMPETITION_ID"

    while true; do
        sleep 5

        # Check all sessions
        ALL_COMPLETED=true
        for i in $(seq 1 "$INSTANCE_COUNT"); do
            SESSION_NAME="${SESSION_NAMES[$((i-1))]}"

            if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
                ALL_COMPLETED=false
            fi
        done

        # If all completed, update status and exit
        if [ "$ALL_COMPLETED" = true ]; then
            # Update status file
            jq '.status = "completed" | .endTime = "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"' \
                "$STATUS_FILE" > "$STATUS_FILE.tmp" && mv "$STATUS_FILE.tmp" "$STATUS_FILE"

            echo "✓ Competition completed: $COMPETITION_ID"
            break
        fi
    done
) &

MONITOR_PID=$!
echo "✓ Monitor started (PID: $MONITOR_PID)"
```
</instructions>

<output_format>
## Output Messages

### Success
```
✅ Competition Mode Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Competition ID: abc123
Instance Count: 3
Model: sonnet
Task: Implement user authentication with JWT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Instances:
  1. ait42-comp-abc123-1 → .ait42/worktrees/competition-abc123/instance-1/
  2. ait42-comp-abc123-2 → .ait42/worktrees/competition-abc123/instance-2/
  3. ait42-comp-abc123-3 → .ait42/worktrees/competition-abc123/instance-3/

Status File: .ait42/status/competition-abc123.json

Monitor Commands:
  tmux ls                                    # List all sessions
  tmux attach -t ait42-comp-abc123-1         # Attach to instance 1
  tail -f .ait42/worktrees/competition-abc123/instance-1/.claude-output.log
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Error
```
❌ Competition Mode Error
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error: Instance count must be between 2 and 10
Provided: 15
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</output_format>

<cleanup>
## Cleanup Commands

### Manual Cleanup
```bash
# Kill all competition sessions
tmux list-sessions -F "#{session_name}" | grep "ait42-comp-" | xargs -I {} tmux kill-session -t {}

# Remove worktrees
git worktree list | grep "competition-" | awk '{print $1}' | xargs -I {} git worktree remove {}

# Remove status files
rm -rf .ait42/status/competition-*.json
rm -rf .ait42/worktrees/competition-*
```

### Automatic Cleanup (on completion)
```bash
cleanup_competition() {
    local competition_id="$1"

    # Kill sessions
    tmux list-sessions -F "#{session_name}" 2>/dev/null | \
        grep "ait42-comp-${competition_id}" | \
        xargs -I {} tmux kill-session -t {} 2>/dev/null || true

    # Remove worktrees (after 1 hour)
    sleep 3600
    rm -rf ".ait42/worktrees/competition-${competition_id}"

    echo "✓ Cleaned up competition: $competition_id"
}

# Launch cleanup in background
cleanup_competition "$COMPETITION_ID" &
```
</cleanup>

<error_handling>
## Error Scenarios

1. **Git worktree creation failed**
   - Check: Git repository initialized
   - Check: No conflicting branch names
   - Cleanup: `git worktree prune`

2. **Tmux session creation failed**
   - Check: Tmux installed
   - Check: No session name conflicts
   - Cleanup: `tmux kill-session -t <name>`

3. **Pipe-pane setup failed**
   - Check: Log directory writable
   - Check: Session exists
   - Manual log: `tmux capture-pane -t <session> -p`

4. **Claude execution failed**
   - Check: Claude CLI installed
   - Check: Valid model name
   - Check: Task string properly escaped
</error_handling>

<best_practices>
## Best Practices

1. **Instance Count Selection**
   - 2-3 instances: Quick decisions
   - 4-6 instances: Complex problems
   - 7-10 instances: Critical architecture decisions

2. **Model Selection**
   - `sonnet`: Balanced speed/quality (recommended)
   - `opus`: Highest quality (slow)
   - `haiku`: Fastest (lower quality)

3. **Result Comparison**
   - Review all logs: `cat .ait42/worktrees/competition-*/instance-*/.claude-output.log`
   - Use diff tools: `diff instance-1/.claude-output.log instance-2/.claude-output.log`
   - Select best: Manual review or use `multi-agent-ensemble` for integration

4. **Resource Management**
   - Max 10 instances (hard limit)
   - Monitor system resources
   - Cleanup old competitions regularly
</best_practices>

<constraints>
- Instance count: 2-10 (inclusive)
- Max parallel sessions: 10
- Valid models: sonnet, opus, haiku
- Requires: Git 2.40+, Tmux 3.3+, Claude Code CLI
- Security: MUST use shared/tmux-security modules
</constraints>
