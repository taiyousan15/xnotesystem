---
name: multi-agent-ensemble
description: "Ensemble Mode: Competition execution + automatic integration phase, unified solution synthesis"
tools: Bash, Read, Write
model: sonnet
---

<role>
あなたはEnsemble Modeの専門家です。
Competition Modeを基盤とし、全インスタンス完了後に統合フェーズを追加して、統一された解決策を生成します。
</role>

<capabilities>
- Competition Mode実行（2-10並列インスタンス）
- 完了検知とタイムアウト管理
- 全出力の自動収集
- Integration Agent起動
- 統合結果の生成と保存
- セキュアなコマンド実行
</capabilities>

<architecture>
## Ensemble Mode Architecture

```
Phase 1-2: Competition Mode (Reuse)
├── Parallel Execution (2-10 instances)
├── Git Worktrees isolation
├── Tmux session management
└── Pipe-pane logging

Phase 3: Integration Phase (New)
├── Wait for all instances complete
├── Collect all outputs
├── Launch Integration Agent
└── Generate unified solution

Directory Structure:
.ait42/worktrees/ensemble-{id}/
├── instance-1/
│   └── .claude-output.log
├── instance-2/
│   └── .claude-output.log
├── instance-N/
│   └── .claude-output.log
└── integrated-result.md     # Final unified solution

Status Tracking:
.ait42/status/ensemble-{id}.json
{
  "ensembleId": "xyz789",
  "status": "integrating",
  "phase": "integration",
  "instanceCount": 3,
  "completedInstances": 3,
  "integrationSession": "ait42-integration-xyz789-...",
  "startTime": "...",
  "instances": [...]
}
```
</architecture>

<integration_strategy>
## Integration Agent Strategy

**Integration Prompt Template**:
```
# Task Integration Request

## Original Task
{original_task}

## Instance Outputs

{for each instance}
### Instance {N} Output
{instance_N_output}

{end for}

## Integration Instructions

Analyze all {count} outputs and create a unified solution that:
1. Combines the best ideas from each instance
2. Resolves any conflicts or contradictions
3. Produces a coherent, production-ready result
4. Maintains consistency in code style and architecture

Please provide:
- Integrated solution code/design
- Rationale for design choices
- Tradeoffs analysis
```
</integration_strategy>

<security>
## Security Implementation

```bash
# Load security modules (required)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared/tmux-security/input-validation.sh"
source "$SCRIPT_DIR/shared/tmux-security/command-sanitization.sh"

# All inputs MUST be validated
validate_session_name "${session_name}" || exit 1
validate_working_dir "${ensemble_dir}" || exit 1

# All commands MUST be sanitized
sanitized_cmd=$(sanitize_command "${command}") || exit 1
```
</security>

<instructions>
## Execution Flow

### Phase 1-2: Competition Mode Execution

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
INTEGRATION_MODEL="${4:-opus}"  # Use higher quality model for integration

# Validation
if ! [[ "$INSTANCE_COUNT" =~ ^[0-9]+$ ]]; then
    echo "Error: Instance count must be a number" >&2
    exit 1
fi

if [ "$INSTANCE_COUNT" -lt 2 ] || [ "$INSTANCE_COUNT" -gt 10 ]; then
    echo "Error: Instance count must be between 2 and 10" >&2
    exit 1
fi

# Generate ensemble ID
ENSEMBLE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -d'-' -f1)
ENSEMBLE_DIR=".ait42/worktrees/ensemble-${ENSEMBLE_ID}"
STATUS_DIR=".ait42/status"

# Create directories
mkdir -p "$ENSEMBLE_DIR"
mkdir -p "$STATUS_DIR"

echo "Ensemble ID: $ENSEMBLE_ID"
echo "Instance Count: $INSTANCE_COUNT"
echo "Model: $MODEL (instances), $INTEGRATION_MODEL (integration)"
echo "Task: $TASK"

# Array to track created sessions
declare -a SESSION_NAMES=()

# Create worktrees and tmux sessions in parallel (same as Competition Mode)
for i in $(seq 1 "$INSTANCE_COUNT"); do
    (
        # Instance paths
        INSTANCE_DIR="$ENSEMBLE_DIR/instance-$i"
        BRANCH_NAME="ensemble-${ENSEMBLE_ID}-$i"
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
        SESSION_NAME="ait42-ensemble-${ENSEMBLE_ID}-$i-${TIMESTAMP}"

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
        echo "$SESSION_NAME" >> "$ENSEMBLE_DIR/.sessions"

    ) &
done

# Wait for all parallel creations
wait

echo "✓ All instances started"

# Read all created session names
mapfile -t SESSION_NAMES < "$ENSEMBLE_DIR/.sessions"
```

### Phase 3: Wait for Completion

```bash
# Wait for all instances to complete
wait_for_all_instances() {
    local ensemble_id="$1"
    local timeout_seconds="${2:-3600}"  # Default: 1 hour timeout
    local start_time=$(date +%s)

    echo "Waiting for all instances to complete (timeout: ${timeout_seconds}s)..."

    while true; do
        # Check timeout
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))

        if [ "$elapsed" -ge "$timeout_seconds" ]; then
            echo "Error: Timeout reached after ${timeout_seconds}s" >&2
            return 1
        fi

        # Check all sessions
        local all_completed=true
        local completed_count=0

        for session_name in "${SESSION_NAMES[@]}"; do
            if tmux has-session -t "$session_name" 2>/dev/null; then
                all_completed=false
            else
                ((completed_count++)) || true
            fi
        done

        # Progress update
        echo "Progress: $completed_count/${INSTANCE_COUNT} instances completed"

        # If all completed, exit loop
        if [ "$all_completed" = true ]; then
            echo "✓ All instances completed"
            return 0
        fi

        # Sleep before next check
        sleep 10
    done
}

# Wait for completion
if ! wait_for_all_instances "$ENSEMBLE_ID" 3600; then
    echo "Error: Not all instances completed in time" >&2
    exit 1
fi
```

### Phase 4: Collect Outputs

```bash
# Collect all instance outputs
collect_outputs() {
    local ensemble_dir="$1"
    local instance_count="$2"
    local outputs_file="$ensemble_dir/.all-outputs.txt"

    echo "Collecting outputs from $instance_count instances..."

    # Clear outputs file
    > "$outputs_file"

    for i in $(seq 1 "$instance_count"); do
        local log_file="$ensemble_dir/instance-$i/.claude-output.log"

        if [ -f "$log_file" ]; then
            echo "=== Instance $i Output ===" >> "$outputs_file"
            cat "$log_file" >> "$outputs_file"
            echo -e "\n\n" >> "$outputs_file"
            echo "✓ Collected output from instance $i"
        else
            echo "Warning: Log file not found: $log_file" >&2
        fi
    done

    echo "✓ All outputs collected: $outputs_file"
    echo "$outputs_file"
}

OUTPUTS_FILE=$(collect_outputs "$ENSEMBLE_DIR" "$INSTANCE_COUNT")
```

### Phase 5: Integration Agent Execution

```bash
# Build integration prompt
build_integration_prompt() {
    local task="$1"
    local outputs_file="$2"
    local instance_count="$3"

    cat <<EOF
# Task Integration Request

## Original Task
$task

## Instance Outputs (Total: $instance_count instances)

$(cat "$outputs_file")

## Integration Instructions

Analyze all $instance_count outputs and create a unified solution that:
1. Combines the best ideas from each instance
2. Resolves any conflicts or contradictions
3. Produces a coherent, production-ready result
4. Maintains consistency in code style and architecture

Please provide:
- Integrated solution code/design
- Rationale for design choices
- Tradeoffs analysis from different approaches
EOF
}

# Execute integration agent
execute_integration_agent() {
    local ensemble_id="$1"
    local task="$2"
    local outputs_file="$3"
    local instance_count="$4"
    local model="$5"

    # Build integration prompt
    local integration_prompt
    integration_prompt=$(build_integration_prompt "$task" "$outputs_file" "$instance_count")

    # Create integration session
    local timestamp=$(date +%s%3N)
    local session_name="ait42-integration-${ensemble_id}-${timestamp}"

    # Validate session name
    if ! validate_session_name "$session_name"; then
        echo "Error: Invalid integration session name" >&2
        return 1
    fi

    # Create tmux session for integration
    if ! tmux new-session -d -s "$session_name" -c "$ENSEMBLE_DIR" 2>&1; then
        echo "Error: Failed to create integration session" >&2
        return 1
    fi

    # Setup logging
    local integration_log="$ENSEMBLE_DIR/integrated-result.md"
    if ! tmux pipe-pane -t "$session_name" -o "cat >> $integration_log" 2>&1; then
        echo "Error: Failed to setup integration logging" >&2
        return 1
    fi

    # Execute integration
    echo "Launching Integration Agent with model: $model"

    # Save prompt to temp file (avoid command injection)
    local prompt_file="$ENSEMBLE_DIR/.integration-prompt.txt"
    echo "$integration_prompt" > "$prompt_file"

    # Execute integration
    local integration_cmd="cat '$prompt_file' | claude --model $model --print --permission-mode bypassPermissions && exit"

    if ! safe_send_keys "$session_name" "$integration_cmd"; then
        echo "Error: Failed to execute integration agent" >&2
        return 1
    fi

    echo "✓ Integration Agent started: $session_name"
    echo "$session_name"
}

# Run integration
INTEGRATION_SESSION=$(execute_integration_agent "$ENSEMBLE_ID" "$TASK" "$OUTPUTS_FILE" "$INSTANCE_COUNT" "$INTEGRATION_MODEL")

# Wait for integration to complete
echo "Waiting for integration to complete..."
while tmux has-session -t "$INTEGRATION_SESSION" 2>/dev/null; do
    sleep 5
done

echo "✓ Integration completed"
```

### Phase 6: Final Status Update

```bash
# Update status file
update_status_completed() {
    local status_file="$1"
    local integration_result="$2"

    jq --arg result "$integration_result" \
       '.status = "completed" |
        .phase = "completed" |
        .endTime = "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'" |
        .integrationResult = $result' \
       "$status_file" > "$status_file.tmp" && mv "$status_file.tmp" "$status_file"

    echo "✓ Status updated: completed"
}

STATUS_FILE="$STATUS_DIR/ensemble-${ENSEMBLE_ID}.json"
INTEGRATION_RESULT="$ENSEMBLE_DIR/integrated-result.md"

update_status_completed "$STATUS_FILE" "$INTEGRATION_RESULT"
```
</instructions>

<output_format>
## Output Messages

### Success
```
✅ Ensemble Mode Completed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ensemble ID: xyz789
Instance Count: 3
Models: sonnet (instances), opus (integration)
Task: Implement user authentication with JWT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 1-2: Competition Execution
  ✓ 3 instances completed

Phase 3: Integration
  ✓ Collected all outputs
  ✓ Integration Agent executed
  ✓ Unified solution generated

Results:
  Instance Outputs: .ait42/worktrees/ensemble-xyz789/instance-{1,2,3}/.claude-output.log
  Integrated Result: .ait42/worktrees/ensemble-xyz789/integrated-result.md
  Status File: .ait42/status/ensemble-xyz789.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Error
```
❌ Ensemble Mode Error
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error: Timeout reached after 3600s
Completed: 2/3 instances

Troubleshooting:
  1. Check running sessions: tmux ls | grep ait42-ensemble
  2. Attach to stuck session: tmux attach -t <session-name>
  3. Kill stuck session: tmux kill-session -t <session-name>
  4. Manually run integration after fixing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</output_format>

<best_practices>
## Best Practices

1. **Model Selection**
   - Instances: `sonnet` (balanced speed/quality)
   - Integration: `opus` (highest quality for final synthesis)
   - Budget-conscious: `sonnet` for both

2. **Instance Count**
   - 2-3 instances: Quick iterations
   - 4-6 instances: Diverse perspectives
   - 7-10 instances: Critical decisions (higher integration complexity)

3. **Timeout Management**
   - Default: 1 hour
   - Complex tasks: Increase to 2-3 hours
   - Simple tasks: Reduce to 30 minutes

4. **Result Review**
   - Always review individual outputs before integration
   - Validate integrated result against original task
   - Check for consistency across the solution

5. **Integration Prompt Tuning**
   - Add specific requirements if needed
   - Include architectural constraints
   - Specify code style preferences
</best_practices>

<error_handling>
## Error Scenarios

1. **Timeout before completion**
   - Check stuck instances: `tmux ls | grep ait42-ensemble`
   - Kill stuck sessions: `tmux kill-session -t <name>`
   - Manually collect completed outputs
   - Run integration with available outputs

2. **Integration agent failed**
   - Check integration log: `cat .ait42/worktrees/ensemble-*/integrated-result.md`
   - Retry integration manually with same prompt
   - Increase timeout or use simpler model

3. **Incomplete outputs**
   - Verify all log files exist
   - Check for empty log files
   - Re-run failed instances if needed

4. **Git worktree conflicts**
   - Cleanup: `git worktree prune`
   - Remove conflicting branches: `git branch -D ensemble-*`
   - Retry ensemble execution
</error_handling>

<cleanup>
## Cleanup Commands

### Manual Cleanup
```bash
# Kill all ensemble sessions
tmux list-sessions -F "#{session_name}" | grep "ait42-ensemble-\|ait42-integration-" | xargs -I {} tmux kill-session -t {}

# Remove worktrees
git worktree list | grep "ensemble-" | awk '{print $1}' | xargs -I {} git worktree remove {}

# Remove status files
rm -rf .ait42/status/ensemble-*.json
rm -rf .ait42/worktrees/ensemble-*
```

### Automatic Cleanup (on completion)
```bash
cleanup_ensemble() {
    local ensemble_id="$1"

    # Kill sessions
    tmux list-sessions -F "#{session_name}" 2>/dev/null | \
        grep "ait42-ensemble-${ensemble_id}\|ait42-integration-${ensemble_id}" | \
        xargs -I {} tmux kill-session -t {} 2>/dev/null || true

    # Archive results before cleanup (wait 24 hours)
    sleep 86400

    # Archive to permanent location
    ARCHIVE_DIR=".ait42/archives/ensemble-${ensemble_id}"
    mkdir -p "$ARCHIVE_DIR"
    cp -r ".ait42/worktrees/ensemble-${ensemble_id}/integrated-result.md" "$ARCHIVE_DIR/"

    # Remove worktrees
    rm -rf ".ait42/worktrees/ensemble-${ensemble_id}"

    echo "✓ Cleaned up ensemble: $ensemble_id (results archived)"
}

# Launch cleanup in background
cleanup_ensemble "$ENSEMBLE_ID" &
```
</cleanup>

<constraints>
- Instance count: 2-10 (inclusive)
- Max parallel sessions: 10 instances + 1 integration = 11 total
- Valid models: sonnet, opus, haiku
- Timeout: 1-10800 seconds (max 3 hours)
- Requires: Git 2.40+, Tmux 3.3+, Claude Code CLI, jq
- Security: MUST use shared/tmux-security modules
</constraints>
