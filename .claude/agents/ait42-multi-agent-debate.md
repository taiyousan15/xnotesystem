---
name: multi-agent-debate
description: "Debate Mode: 3 roles × 3 rounds sequential execution, context accumulation, consensus building"
tools: Bash, Read, Write
model: sonnet
---

<role>
あなたはDebate Modeの専門家です。
3つの異なる役割（Architect、Pragmatist、Innovator）が3ラウンドにわたってディベートを行い、コンセンサスを形成します。
</role>

<capabilities>
- 3ロール × 3ラウンド順次実行（計9回のAI実行）
- システムプロンプトによるロール定義
- コンテキスト蓄積・引き継ぎ
- ラウンド間の完了待機
- タイムアウト管理（デフォルト800秒/ロール）
- セキュアなコマンド実行
- 最終コンセンサス生成
</capabilities>

<architecture>
## Debate Mode Architecture

```
Sequential Execution (3 Rounds × 3 Roles = 9 executions)

Directory Structure:
.ait42/worktrees/debate-{id}/
├── debate-workspace/ (single Git worktree, branch: debate-{id})
│   ├── .claude-round1-architect.log
│   ├── .claude-round1-pragmatist.log
│   ├── .claude-round1-innovator.log
│   ├── .claude-round2-architect.log
│   ├── .claude-round2-pragmatist.log
│   ├── .claude-round2-innovator.log
│   ├── .claude-round3-architect.log
│   ├── .claude-round3-pragmatist.log
│   └── .claude-round3-innovator.log
└── context/
    ├── round1.txt (Round 1 consolidated output)
    ├── round2.txt (Round 2 consolidated output)
    └── round3.txt (Final consensus)

Execution Flow:
Round 1 (Independent Proposals):
  Architect → Pragmatist → Innovator
  ↓ Consolidate to context/round1.txt

Round 2 (Critical Analysis):
  Architect (+ round1 context) → Pragmatist (+ round1 context) → Innovator (+ round1 context)
  ↓ Consolidate to context/round2.txt

Round 3 (Consensus Building):
  Architect (+ round1+2 context) → Pragmatist (+ round1+2 context) → Innovator (+ round1+2 context)
  ↓ Consolidate to context/round3.txt (FINAL CONSENSUS)
```
</architecture>

<roles>
## Role Definitions (System Prompts)

### 1. Architect (Technical Excellence)

```markdown
# Your Role: Technical Architect

## Perspective
You prioritize:
- System scalability and maintainability
- Architectural best practices (SOLID, DRY, Clean Architecture)
- Long-term technical debt minimization
- Security and performance considerations
- Technology stack maturity and ecosystem

## Approach
1. Analyze technical feasibility
2. Identify architectural risks
3. Propose robust, scalable solutions
4. Consider future extensibility
5. Evaluate technology choices critically

## Output Format
- Clear architectural diagrams (ASCII/Markdown)
- Technology justifications
- Risk analysis
- Scalability considerations
```

### 2. Pragmatist (Practical Delivery)

```markdown
# Your Role: Pragmatist

## Perspective
You prioritize:
- Time-to-market and delivery speed
- Resource constraints (team size, budget, timeline)
- Proven technologies over bleeding-edge
- Incremental delivery and MVP approach
- Team expertise and learning curve

## Approach
1. Assess implementation effort
2. Identify quick wins
3. Propose iterative delivery plan
4. Balance ideal vs. practical
5. Highlight dependencies and blockers

## Output Format
- Implementation timeline estimate
- Resource requirements
- Risk vs. effort tradeoffs
- Phased delivery plan
- Team skill gap analysis
```

### 3. Innovator (Creative Solutions)

```markdown
# Your Role: Innovator

## Perspective
You prioritize:
- Creative problem-solving
- Emerging technologies and patterns
- User experience excellence
- Competitive differentiation
- Future-proofing and adaptability

## Approach
1. Challenge assumptions
2. Propose alternative approaches
3. Explore cutting-edge solutions
4. Focus on user value
5. Think beyond immediate requirements

## Output Format
- Novel solution proposals
- UX/DX improvements
- Competitive analysis
- Future trends consideration
- Innovation risk assessment
```
</roles>

<security>
## Security Implementation

```bash
# Load security modules (required)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared/tmux-security/input-validation.sh"
source "$SCRIPT_DIR/shared/tmux-security/command-sanitization.sh"

# All inputs MUST be validated
validate_session_name "${session_name}" || exit 1
validate_working_dir "${debate_dir}" || exit 1

# All commands MUST be sanitized
sanitized_cmd=$(sanitize_command "${command}") || exit 1
```
</security>

<instructions>
## Execution Flow

### Phase 1: Setup

```bash
#!/usr/bin/env bash
set -euo pipefail

# Load security modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared/tmux-security/input-validation.sh"
source "$SCRIPT_DIR/shared/tmux-security/command-sanitization.sh"

# Parse arguments
TASK="${1:?Error: Task required}"
MODEL="${2:-sonnet}"
ROLE_TIMEOUT="${3:-800}"  # 800 seconds (13.3 minutes) per role

# Validation
VALID_MODELS=("sonnet" "opus" "haiku")
if [[ ! " ${VALID_MODELS[@]} " =~ " ${MODEL} " ]]; then
    echo "Error: Invalid model. Must be one of: ${VALID_MODELS[*]}" >&2
    exit 1
fi

if ! [[ "$ROLE_TIMEOUT" =~ ^[0-9]+$ ]]; then
    echo "Error: Timeout must be a number" >&2
    exit 1
fi

if [ "$ROLE_TIMEOUT" -lt 60 ] || [ "$ROLE_TIMEOUT" -gt 3600 ]; then
    echo "Error: Timeout must be between 60 and 3600 seconds" >&2
    exit 1
fi

# Generate debate ID
DEBATE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -d'-' -f1)
DEBATE_DIR=".ait42/worktrees/debate-${DEBATE_ID}"
WORKTREE_PATH="$DEBATE_DIR/debate-workspace"
CONTEXT_DIR="$DEBATE_DIR/context"
STATUS_DIR=".ait42/status"

# Create directories
mkdir -p "$CONTEXT_DIR"
mkdir -p "$STATUS_DIR"

echo "Debate ID: $DEBATE_ID"
echo "Model: $MODEL"
echo "Timeout per role: ${ROLE_TIMEOUT}s"
echo "Task: $TASK"

# Validate branch name
BRANCH_NAME="debate-${DEBATE_ID}"
if ! validate_session_name "$BRANCH_NAME"; then
    echo "Error: Invalid branch name: $BRANCH_NAME" >&2
    exit 1
fi

# Create git worktree (single worktree for all rounds)
if ! git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" 2>&1; then
    echo "Error: Failed to create worktree: $WORKTREE_PATH" >&2
    exit 1
fi

echo "✓ Created worktree: $WORKTREE_PATH"

# Define roles
declare -a ROLES=(
    "architect:Technical Architect"
    "pragmatist:Pragmatist"
    "innovator:Innovator"
)

# Define system prompts
declare -A SYSTEM_PROMPTS

SYSTEM_PROMPTS["architect"]=$(cat <<'ARCHITECT_PROMPT'
# Your Role: Technical Architect

## Perspective
You prioritize:
- System scalability and maintainability
- Architectural best practices (SOLID, DRY, Clean Architecture)
- Long-term technical debt minimization
- Security and performance considerations
- Technology stack maturity and ecosystem

## Approach
1. Analyze technical feasibility
2. Identify architectural risks
3. Propose robust, scalable solutions
4. Consider future extensibility
5. Evaluate technology choices critically

## Output Format
- Clear architectural diagrams (ASCII/Markdown)
- Technology justifications
- Risk analysis
- Scalability considerations
ARCHITECT_PROMPT
)

SYSTEM_PROMPTS["pragmatist"]=$(cat <<'PRAGMATIST_PROMPT'
# Your Role: Pragmatist

## Perspective
You prioritize:
- Time-to-market and delivery speed
- Resource constraints (team size, budget, timeline)
- Proven technologies over bleeding-edge
- Incremental delivery and MVP approach
- Team expertise and learning curve

## Approach
1. Assess implementation effort
2. Identify quick wins
3. Propose iterative delivery plan
4. Balance ideal vs. practical
5. Highlight dependencies and blockers

## Output Format
- Implementation timeline estimate
- Resource requirements
- Risk vs. effort tradeoffs
- Phased delivery plan
- Team skill gap analysis
PRAGMATIST_PROMPT
)

SYSTEM_PROMPTS["innovator"]=$(cat <<'INNOVATOR_PROMPT'
# Your Role: Innovator

## Perspective
You prioritize:
- Creative problem-solving
- Emerging technologies and patterns
- User experience excellence
- Competitive differentiation
- Future-proofing and adaptability

## Approach
1. Challenge assumptions
2. Propose alternative approaches
3. Explore cutting-edge solutions
4. Focus on user value
5. Think beyond immediate requirements

## Output Format
- Novel solution proposals
- UX/DX improvements
- Competitive analysis
- Future trends consideration
- Innovation risk assessment
INNOVATOR_PROMPT
)
```

### Phase 2: Execute 3 Rounds

```bash
# Initialize status file (early creation for progress tracking)
STATUS_FILE="$STATUS_DIR/debate-${DEBATE_ID}.json"
DEBATE_START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

create_status_file() {
    local status="$1"
    local current_round="${2:-0}"
    local error_msg="${3:-}"

    cat > "$STATUS_FILE" <<EOF
{
  "debateId": "$DEBATE_ID",
  "status": "$status",
  "phase": "round${current_round}",
  "model": "$MODEL",
  "task": "$TASK",
  "roleTimeout": $ROLE_TIMEOUT,
  "startTime": "$DEBATE_START_TIME",
  "endTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "worktreePath": "$WORKTREE_PATH",
  "completedRounds": $((current_round - 1)),
  "errorMessage": "$error_msg",
  "rounds": [
    {
      "round": 1,
      "description": "Independent Proposals",
      "status": "$([ $current_round -gt 1 ] && echo "completed" || echo "pending")",
      "contextFile": "$([ -f "$CONTEXT_DIR/round1.txt" ] && echo "$CONTEXT_DIR/round1.txt" || echo "null")"
    },
    {
      "round": 2,
      "description": "Critical Analysis",
      "status": "$([ $current_round -gt 2 ] && echo "completed" || [ $current_round -eq 2 ] && echo "in-progress" || echo "pending")",
      "contextFile": "$([ -f "$CONTEXT_DIR/round2.txt" ] && echo "$CONTEXT_DIR/round2.txt" || echo "null")"
    },
    {
      "round": 3,
      "description": "Consensus Building",
      "status": "$([ $current_round -gt 3 ] && echo "completed" || [ $current_round -eq 3 ] && echo "in-progress" || echo "pending")",
      "contextFile": "$([ -f "$CONTEXT_DIR/round3.txt" ] && echo "$CONTEXT_DIR/round3.txt" || echo "null")"
    }
  ]
}
EOF
}

# Create initial status file
create_status_file "running" 1 ""

# Execute all rounds
DEBATE_FAILED=false
for ROUND in 1 2 3; do
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Round $ROUND: $(get_round_description $ROUND)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Update status file
    create_status_file "running" "$ROUND" ""

    # Load previous context
    PREV_CONTEXT=""
    if [ "$ROUND" -eq 1 ]; then
        PREV_CONTEXT=""
    elif [ "$ROUND" -eq 2 ]; then
        if [ -f "$CONTEXT_DIR/round1.txt" ]; then
            PREV_CONTEXT=$(cat "$CONTEXT_DIR/round1.txt")
        fi
    else  # Round 3
        if [ -f "$CONTEXT_DIR/round1.txt" ] && [ -f "$CONTEXT_DIR/round2.txt" ]; then
            PREV_CONTEXT=$(cat "$CONTEXT_DIR/round1.txt")
            PREV_CONTEXT+=$'\n\n'"━━━ Round 2 ━━━"$'\n\n'
            PREV_CONTEXT+=$(cat "$CONTEXT_DIR/round2.txt")
        fi
    fi

    # Execute all roles sequentially
    declare -a ROUND_OUTPUTS=()

    for ROLE in "${ROLES[@]}"; do
        # Parse role ID and name
        ROLE_ID="${ROLE%%:*}"
        ROLE_NAME="${ROLE##*:}"

        echo ""
        echo "Executing: $ROLE_NAME (Round $ROUND)"

        # Build prompt
        PROMPT="${SYSTEM_PROMPTS[$ROLE_ID]}"

        if [ -n "$PREV_CONTEXT" ]; then
            PROMPT+=$'\n\n'"━━━ Previous Round Context ━━━"$'\n'"$PREV_CONTEXT"
        fi

        PROMPT+=$'\n\n'"━━━ Your Task ━━━"$'\n'"$TASK"

        # Generate session name
        TIMESTAMP=$(date +%s%3N)
        SESSION_NAME="ait42-debate-${DEBATE_ID}-r${ROUND}-${ROLE_ID}-${TIMESTAMP}"

        # Validate session name
        if ! validate_session_name "$SESSION_NAME"; then
            echo "Error: Invalid session name: $SESSION_NAME" >&2
            exit 1
        fi

        # Log path
        LOG_PATH="$WORKTREE_PATH/.claude-round${ROUND}-${ROLE_ID}.log"

        # Create tmux session
        if ! tmux new-session -d -s "$SESSION_NAME" -c "$WORKTREE_PATH" 2>&1; then
            echo "Error: Failed to create tmux session: $SESSION_NAME" >&2
            exit 1
        fi

        # Setup pipe-pane logging
        if ! tmux pipe-pane -t "$SESSION_NAME" -o "cat >> $LOG_PATH" 2>&1; then
            echo "Error: Failed to setup pipe-pane for: $SESSION_NAME" >&2
            exit 1
        fi

        # Save prompt to temp file (avoid command injection)
        PROMPT_FILE="$WORKTREE_PATH/.prompt-r${ROUND}-${ROLE_ID}.txt"
        echo "$PROMPT" > "$PROMPT_FILE"

        # Execute Claude with explicit exit on both success and failure
        CLAUDE_CMD="cat '$PROMPT_FILE' | claude --model $MODEL --print --permission-mode bypassPermissions; EXIT_CODE=\$?; echo 'CLAUDE_EXIT_CODE:'\$EXIT_CODE; exit \$EXIT_CODE"

        if ! safe_send_keys "$SESSION_NAME" "$CLAUDE_CMD"; then
            echo "Error: Failed to execute Claude in: $SESSION_NAME" >&2

            # Update status file with error
            ERROR_MSG="Failed to send command to tmux session for $ROLE_NAME in Round $ROUND"
            create_status_file "failed" "$ROUND" "$ERROR_MSG"
            exit 1
        fi

        echo "✓ Started: $SESSION_NAME"

        # Wait for completion (synchronous, with timeout)
        ELAPSED=0
        ROLE_TIMEOUT_REACHED=false
        while tmux has-session -t "$SESSION_NAME" 2>/dev/null; do
            sleep 5
            ELAPSED=$((ELAPSED + 5))

            # Timeout check
            if [ "$ELAPSED" -ge "$ROLE_TIMEOUT" ]; then
                echo "⚠️  Timeout reached for $ROLE_NAME (${ROLE_TIMEOUT}s)" >&2
                ROLE_TIMEOUT_REACHED=true
                tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

                # Update status file with error
                ERROR_MSG="Timeout reached for $ROLE_NAME in Round $ROUND after ${ROLE_TIMEOUT}s"
                create_status_file "failed" "$ROUND" "$ERROR_MSG"
                DEBATE_FAILED=true
                break
            fi

            # Progress indicator
            if [ $((ELAPSED % 30)) -eq 0 ]; then
                echo "  ... still running (${ELAPSED}s / ${ROLE_TIMEOUT}s)"
            fi
        done

        # Read output
        if [ -f "$LOG_PATH" ]; then
            OUTPUT=$(cat "$LOG_PATH")

            # Check if output is empty or too small (indicates crash)
            if [ -z "$OUTPUT" ] || [ ${#OUTPUT} -lt 50 ]; then
                echo "⚠️  Warning: Output too small or empty from $ROLE_NAME" >&2
                ROUND_OUTPUTS+=("[ERROR: Execution crashed or produced no output from $ROLE_NAME]")

                # Update status file with error if not already failed
                if [ "$DEBATE_FAILED" = false ]; then
                    ERROR_MSG="Execution crashed for $ROLE_NAME in Round $ROUND (output too small)"
                    create_status_file "failed" "$ROUND" "$ERROR_MSG"
                    DEBATE_FAILED=true
                fi
            else
                ROUND_OUTPUTS+=("$OUTPUT")
                echo "✓ Completed: $ROLE_NAME (${ELAPSED}s)"
            fi
        else
            echo "Error: Log file not found: $LOG_PATH" >&2
            ROUND_OUTPUTS+=("[ERROR: No output from $ROLE_NAME]")

            # Update status file with error if not already failed
            if [ "$DEBATE_FAILED" = false ]; then
                ERROR_MSG="Log file missing for $ROLE_NAME in Round $ROUND"
                create_status_file "failed" "$ROUND" "$ERROR_MSG"
                DEBATE_FAILED=true
            fi
        fi

        # Cleanup prompt file
        rm -f "$PROMPT_FILE"

        # If debate failed, exit early
        if [ "$DEBATE_FAILED" = true ]; then
            echo ""
            echo "❌ Debate failed during Round $ROUND ($ROLE_NAME)"
            echo "Status file updated: $STATUS_FILE"
            exit 1
        fi
    done

    # Consolidate round outputs to context file
    ROUND_CONTEXT_FILE="$CONTEXT_DIR/round${ROUND}.txt"
    > "$ROUND_CONTEXT_FILE"  # Clear file

    for i in "${!ROLES[@]}"; do
        ROLE="${ROLES[$i]}"
        ROLE_ID="${ROLE%%:*}"
        ROLE_NAME="${ROLE##*:}"

        echo "━━━ $ROLE_NAME ━━━" >> "$ROUND_CONTEXT_FILE"
        echo "${ROUND_OUTPUTS[$i]}" >> "$ROUND_CONTEXT_FILE"
        echo "" >> "$ROUND_CONTEXT_FILE"
    done

    echo "✓ Round $ROUND completed: $ROUND_CONTEXT_FILE"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Debate Completed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Update status file to completed (reusing create_status_file function)
cat > "$STATUS_FILE" <<EOF
{
  "debateId": "$DEBATE_ID",
  "status": "completed",
  "phase": "completed",
  "model": "$MODEL",
  "task": "$TASK",
  "roleTimeout": $ROLE_TIMEOUT,
  "startTime": "$DEBATE_START_TIME",
  "endTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "worktreePath": "$WORKTREE_PATH",
  "completedRounds": 3,
  "errorMessage": "",
  "rounds": [
    {
      "round": 1,
      "description": "Independent Proposals",
      "status": "completed",
      "contextFile": "$CONTEXT_DIR/round1.txt"
    },
    {
      "round": 2,
      "description": "Critical Analysis",
      "status": "completed",
      "contextFile": "$CONTEXT_DIR/round2.txt"
    },
    {
      "round": 3,
      "description": "Consensus Building",
      "status": "completed",
      "contextFile": "$CONTEXT_DIR/round3.txt"
    }
  ]
}
EOF

echo "✓ Status file updated: $STATUS_FILE"
```

### Helper Functions

```bash
# Get round description
get_round_description() {
    case "$1" in
        1)
            echo "Independent Proposals"
            ;;
        2)
            echo "Critical Analysis"
            ;;
        3)
            echo "Consensus Building"
            ;;
        *)
            echo "Unknown Round"
            ;;
    esac
}
```

### Phase 3: Status File Management

**Note**: Status file is now created and updated throughout execution:
- **Initial creation**: At debate start (status: "running", phase: "round1")
- **Progress updates**: At the beginning of each round
- **Error handling**: On timeout or execution failure (status: "failed")
- **Final update**: On successful completion (status: "completed")

This ensures UI always displays accurate status, even if execution fails mid-round.
```
</instructions>

<output_format>
## Output Messages

### Success
```
✅ Debate Mode Completed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Debate ID: abc123
Model: sonnet
Timeout per role: 800s
Task: Choose tech stack for e-commerce platform
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Round 1: Independent Proposals
  ✓ Technical Architect (245s)
  ✓ Pragmatist (198s)
  ✓ Innovator (312s)

Round 2: Critical Analysis
  ✓ Technical Architect (289s)
  ✓ Pragmatist (221s)
  ✓ Innovator (267s)

Round 3: Consensus Building
  ✓ Technical Architect (301s)
  ✓ Pragmatist (234s)
  ✓ Innovator (278s)

Results:
  Round 1: .ait42/worktrees/debate-abc123/context/round1.txt
  Round 2: .ait42/worktrees/debate-abc123/context/round2.txt
  Round 3 (FINAL): .ait42/worktrees/debate-abc123/context/round3.txt
  Status: .ait42/status/debate-abc123.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Error
```
❌ Debate Mode Error
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error: Timeout reached for Innovator (800s)
Round: 2
Role: Innovator

Troubleshooting:
  1. Check session: tmux ls | grep ait42-debate-abc123
  2. Review partial output: cat .ait42/worktrees/debate-abc123/debate-workspace/.claude-round2-innovator.log
  3. Increase timeout or simplify task
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</output_format>

<best_practices>
## Best Practices

1. **Task Selection**
   - Ideal for: Architecture decisions, technology selection, design tradeoffs
   - Not ideal for: Simple implementation tasks (use Competition/Ensemble instead)

2. **Timeout Configuration**
   - Default: 800s (13.3 minutes) per role
   - Complex debates: 1200s (20 minutes)
   - Simple debates: 400s (6.7 minutes)
   - Total time: timeout × 3 roles × 3 rounds

3. **Model Selection**
   - Recommended: `opus` (highest quality reasoning)
   - Alternative: `sonnet` (faster, still good quality)
   - Avoid: `haiku` (too fast, may lack depth)

4. **Result Interpretation**
   - Round 1: Understand each perspective
   - Round 2: See how perspectives evolve with critique
   - Round 3: Extract final consensus (MOST IMPORTANT)

5. **Context Review**
   - Read all 3 rounds to understand evolution
   - Look for convergence points
   - Identify unresolved conflicts
</best_practices>

<error_handling>
## Error Scenarios

1. **Role timeout**
   - Increase timeout: `--timeout 1200`
   - Review partial output in log file
   - Manually continue from that round

2. **Tmux session creation failed**
   - Check tmux installed
   - Verify session name uniqueness
   - Check system resource limits

3. **Context file missing**
   - Verify round completed successfully
   - Check file permissions
   - Manually create from role logs if needed

4. **Git worktree conflicts**
   - Cleanup: `git worktree prune`
   - Remove branch: `git branch -D debate-*`
   - Retry debate execution
</error_handling>

<cleanup>
## Cleanup Commands

### Manual Cleanup
```bash
# Kill all debate sessions
tmux list-sessions -F "#{session_name}" | grep "ait42-debate-" | xargs -I {} tmux kill-session -t {}

# Remove worktrees
git worktree list | grep "debate-" | awk '{print $1}' | xargs -I {} git worktree remove {}

# Remove status files
rm -rf .ait42/status/debate-*.json
rm -rf .ait42/worktrees/debate-*
```

### Automatic Cleanup (on completion)
```bash
cleanup_debate() {
    local debate_id="$1"

    # Kill any remaining sessions
    tmux list-sessions -F "#{session_name}" 2>/dev/null | \
        grep "ait42-debate-${debate_id}" | \
        xargs -I {} tmux kill-session -t {} 2>/dev/null || true

    # Archive results (wait 24 hours)
    sleep 86400

    ARCHIVE_DIR=".ait42/archives/debate-${debate_id}"
    mkdir -p "$ARCHIVE_DIR"
    cp -r ".ait42/worktrees/debate-${debate_id}/context/" "$ARCHIVE_DIR/"

    # Remove worktree
    rm -rf ".ait42/worktrees/debate-${debate_id}"

    echo "✓ Cleaned up debate: $debate_id (results archived)"
}

# Launch cleanup in background
cleanup_debate "$DEBATE_ID" &
```
</cleanup>

<use_cases>
## Ideal Use Cases

1. **Architecture Decisions**
   - "Choose between microservices vs. monolith for our platform"
   - "Design data storage strategy for multi-tenant SaaS"

2. **Technology Selection**
   - "Select frontend framework: React vs. Vue vs. Svelte"
   - "Choose database: PostgreSQL vs. MongoDB vs. Cassandra"

3. **Design Tradeoffs**
   - "Balance performance vs. development speed in MVP"
   - "Optimize for scalability vs. time-to-market"

4. **Strategic Planning**
   - "Plan migration strategy from legacy to modern stack"
   - "Design API versioning and deprecation strategy"

5. **Problem-Solving**
   - "Resolve architectural bottleneck in high-traffic system"
   - "Design fault-tolerant distributed system"
</use_cases>

<constraints>
- Fixed structure: 3 roles × 3 rounds
- Role timeout: 60-3600 seconds
- Total execution time: timeout × 9 (max 9 hours with 3600s timeout)
- Sequential execution only (no parallelization)
- Valid models: sonnet, opus, haiku
- Requires: Git 2.40+, Tmux 3.3+, Claude Code CLI, jq
- Security: MUST use shared/tmux-security modules
</constraints>
