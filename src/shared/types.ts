export type ProjectId = string
export type TerminalId = string

/** Reserved id of the synthesized "Home" workspace that holds project-less terminals. */
export const HOME_PROJECT_ID = 'home'

/** Largest file (in bytes) the in-app editor will load as text. */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

/** Human-readable form of {@link MAX_TEXT_FILE_BYTES}, e.g. "5 MB". */
export const MAX_TEXT_FILE_LABEL = '5 MB'

export interface TerminalRecord {
  id: TerminalId
  name: string
  shell: string
  /**
   * The Claude Code session id wTerm launched this tab with (`--session-id`).
   * Present only for tabs whose startup command launched `claude`; its presence
   * marks the tab as a restorable Claude session — on the next launch the tab is
   * recreated running `claude --resume <id>`. Bare-shell tabs leave this unset
   * and remain session-scoped (not restored).
   */
  claudeSessionId?: string
  /**
   * The long-running agent command (and the cwd it ran in) that was active in
   * this tab at last save, captured alias-expanded from shell integration
   * (OSC 697). On the next launch the tab is recreated in that cwd running the
   * command's "resume" form (see the resume map in renderer settings) so agents
   * like `claude`, `cursor-agent`, or `aider` pick up where they left off.
   * Unset for tabs that were idling at a prompt.
   *
   * `sessionId` is the exact Claude session discovered for a hand-typed launch
   * (parsed from an explicit `--resume <id>` or sniffed from
   * `~/.claude/projects/<cwd-slug>/`). Unlike {@link claudeSessionId} it is
   * agent-scoped: it lives and dies with the capture, so exiting the agent
   * clears it.
   */
  agent?: { command: string; cwd: string; sessionId?: string }
}

export interface Project {
  id: ProjectId
  name: string
  path: string
  color: string
  terminals: TerminalRecord[]
  /** True only for the synthesized Home workspace; never persisted. */
  isDefault?: boolean
}

/** Current persisted state schema version. */
export const STATE_VERSION = 2

export interface AppState {
  version: number
  selectedProjectId: ProjectId | null
  projects: Project[]
  activeTerminalByProject?: Record<ProjectId, TerminalId | null>
  /** Board cards, flat and scoped by projectId (see Card). */
  cards?: Card[]
  /** Per-project markdown scratchpad notes. */
  notes?: Note[]
  /** Per-project board/worker configuration. */
  boardByProject?: Record<ProjectId, BoardSettings>
}

// ---- Project board ----

export type CardStatus = 'backlog' | 'ready' | 'in-progress' | 'review' | 'done'

/** The five columns, in board order. */
export const CARD_STATUSES: readonly CardStatus[] = [
  'backlog',
  'ready',
  'in-progress',
  'review',
  'done',
]

export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  'in-progress': 'In Progress',
  review: 'Review',
  done: 'Done',
}

/** A dispatched worker: the tab, the worktree, and the branch it owns. */
export interface CardRun {
  terminalId: TerminalId
  worktreePath: string
  branch: string
  startedAt: string
  endedAt?: string
  /**
   * False until the worker's activity first reports `busy`. A freshly created
   * PTY reads as idle before the agent starts, so a run only becomes
   * completable once it has actually begun working.
   */
  started: boolean
  /** True while the agent is ringing the BEL for input (activity `attention`). */
  needsInput?: boolean
}

export interface CardLogEntry {
  at: string
  text: string
}

/** Most recent log entries kept per card (state.json is a whole-file write). */
export const CARD_LOG_LIMIT = 50

export interface Card {
  id: string
  projectId: ProjectId
  /** per-project, monotonic, human-facing ("#42") */
  number: number
  title: string
  /** markdown; becomes the dispatched prompt */
  body: string
  status: CardStatus
  /** sort key within a column; lower dispatches first */
  order: number
  createdAt: string
  /** set on dispatch, cleared when the card returns to backlog/ready */
  run?: CardRun
  /** append-only history, capped at {@link CARD_LOG_LIMIT} */
  log: CardLogEntry[]
}

export interface Note {
  id: string
  projectId: ProjectId
  title: string
  body: string
  updatedAt: string
}

export interface BoardSettings {
  /** 0 disables automation — the board becomes a plain board */
  workerCount: number
  agentCommand: string
  /** supports {{number}}, {{title}}, {{cardFile}}, {{branch}} */
  promptTemplate: string
  /** absolute path; empty = the project path's parent */
  worktreeRoot: string
}

export const DEFAULT_PROMPT_TEMPLATE =
  'Read {{cardFile}} and implement the task described there. You are on branch {{branch}}.'

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  workerCount: 0,
  agentCommand: 'claude',
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  worktreeRoot: '',
}

/** Everything the board tab needs for one project. */
export interface BoardSnapshot {
  cards: Card[]
  notes: Note[]
  settings: BoardSettings
}

export interface CreateCardInput {
  projectId: ProjectId
  title: string
  body?: string
  status?: CardStatus
}

export interface UpdateCardInput {
  id: string
  title?: string
  body?: string
}

export interface MoveCardInput {
  id: string
  status: CardStatus
  /** index within the destination column; appended when omitted */
  index?: number
}

export interface CreateTerminalOptions {
  projectId: ProjectId
  name?: string
  shell?: string
  /** working directory, relative to the project root; defaults to the project root */
  cwd?: string
  /**
   * Command (or multi-line script) to run once the shell is ready. For a brand
   * new tab this is the user's configured startup command; when {@link resumeSessionId}
   * is set it is the base used to rebuild the `claude --resume` command.
   */
  startupCommand?: string
  /**
   * Reuse this exact terminal id instead of generating a new one. Set only on
   * the restore path so the recreated PTY lines up with the persisted record,
   * its tab, and the active-tab selection.
   */
  id?: TerminalId
  /**
   * Restore mode: resume the Claude session with this id. The PTY is launched
   * with `claude --resume <resumeSessionId>` (built from {@link startupCommand}),
   * and the record's {@link TerminalRecord.claudeSessionId} is preserved.
   */
  resumeSessionId?: string
}

export type TerminalDataPayload = { id: TerminalId; data: string }
export type TerminalExitPayload = { id: TerminalId; exitCode: number; signal?: number }
/**
 * Reported by the renderer when a tab's foreground command starts (`agent` set)
 * or finishes (`agent` null), parsed from the OSC 697 shell-integration marker.
 */
export type RunningCommandPayload = {
  id: TerminalId
  agent: { command: string; cwd: string } | null
}

export type ActivityStatus = 'idle' | 'busy' | 'attention'
/**
 * Why a session is asking for the user. Only a first-party agent hook can tell
 * these apart — from outside, a permission prompt and a finished turn look the
 * same, because the spinner stops either way.
 */
export type AttentionReason = 'permission' | 'turnDone'
/** Emitted by main when a session's detected activity changes. */
export type SessionActivityPayload = {
  id: TerminalId
  status: ActivityStatus
  title: string | null
  exitCode: number | null
  /** Set alongside `status: 'attention'`; null otherwise. */
  reason: AttentionReason | null
  /** The agent's own words for why it needs the user, when it said so. */
  detail: string | null
  /** When `status` last changed — the renderer derives "stale" from this. */
  changedAt: number
}
/**
 * State of wTerm's Claude Code hook installation. `listening` is the loopback
 * relay socket (always up); `installed` is whether the user's Claude settings
 * actually point at it, which is what the user opts into.
 */
export type AgentHooksStatus = {
  installed: boolean
  listening: boolean
  settingsPath: string
  /** Set when the settings file exists but could not be read or parsed. */
  error: string | null
}

/** Sent by the renderer so main can suppress notifications for the on-screen session. */
export type SetFocusedPayload = { id: TerminalId | null; windowFocused: boolean }

export const IPC = {
  projects: {
    snapshot: 'projects:snapshot',
    add: 'projects:add',
    remove: 'projects:remove',
    rename: 'projects:rename',
    reorder: 'projects:reorder',
    select: 'projects:select',
    openInITerm: 'projects:open-in-iterm',
    openInFinder: 'projects:open-in-finder',
  },
  terminals: {
    create: 'terminals:create',
    attach: 'terminals:attach',
    write: 'terminals:write',
    resize: 'terminals:resize',
    kill: 'terminals:kill',
    rename: 'terminals:rename',
    data: 'terminals:data',
    exit: 'terminals:exit',
    setActive: 'terminals:set-active',
    runningCommand: 'terminals:running-command',
    activity: 'terminals:activity',
    setFocused: 'terminals:set-focused',
  },
  agent: {
    status: 'agent:hooks-status',
    install: 'agent:hooks-install',
    uninstall: 'agent:hooks-uninstall',
  },
  dialog: {
    pickFolder: 'dialog:pick-folder',
  },
  system: {
    notify: 'system:notify',
    focusTerminal: 'system:focus-terminal',
    openExternal: 'system:open-external',
    version: 'system:version',
    setZoom: 'system:set-zoom',
  },
  /** Full-state push from main to renderer, fired after bridge-originated mutations. */
  state: {
    changed: 'state:changed',
  },
  /** Project board + notes (see src/main/board). */
  board: {
    snapshot: 'board:snapshot',
    createCard: 'board:create-card',
    updateCard: 'board:update-card',
    moveCard: 'board:move-card',
    deleteCard: 'board:delete-card',
    dispatchNow: 'board:dispatch-now',
    createNote: 'board:create-note',
    updateNote: 'board:update-note',
    deleteNote: 'board:delete-note',
    promoteNote: 'board:promote-note',
    setSettings: 'board:set-settings',
    pruneWorktree: 'board:prune-worktree',
    /** main → renderer push after any board mutation (scheduler included) */
    changed: 'board:changed',
  },
  /** Mobile-bridge control + reachability (see src/main/bridge). */
  bridge: {
    getStatus: 'bridge:get-status',
    status: 'bridge:status',
    getPairing: 'bridge:get-pairing',
    regeneratePairing: 'bridge:regenerate-pairing',
    setKeepAwake: 'bridge:set-keep-awake',
  },
  update: {
    check: 'update:check',
    install: 'update:install',
    getStatus: 'update:get-status',
    status: 'update:status',
  },
  fs: {
    list: 'fs:list',
    readText: 'fs:read-text',
    writeText: 'fs:write-text',
    createFile: 'fs:create-file',
    createFolder: 'fs:create-folder',
    rename: 'fs:rename',
    remove: 'fs:remove',
    duplicate: 'fs:duplicate',
    open: 'fs:open',
    reveal: 'fs:reveal',
    saveTempPaste: 'fs:save-temp-paste',
  },
  git: {
    repos: 'git:repos',
    info: 'git:info',
    push: 'git:push',
    fileStatus: 'git:file-status',
  },
  github: {
    getSettings: 'github:get-settings',
    setClientId: 'github:set-client-id',
    setToken: 'github:set-token',
    signOut: 'github:sign-out',
    deviceStart: 'github:device-start',
    devicePoll: 'github:device-poll',
    listPullRequests: 'github:list-prs',
    getPullRequest: 'github:get-pr',
    createPullRequest: 'github:create-pr',
    mergePullRequest: 'github:merge-pr',
    commentPullRequest: 'github:comment-pr',
    listWorkflows: 'github:list-workflows',
    listRuns: 'github:list-runs',
    getRun: 'github:get-run',
    rerunRun: 'github:rerun-run',
    rerunFailed: 'github:rerun-failed',
    cancelRun: 'github:cancel-run',
    dispatchWorkflow: 'github:dispatch-workflow',
  },
} as const

export interface NotifyPayload {
  title: string
  body: string
  projectId: ProjectId
  terminalId: TerminalId
}

// ---- Mobile bridge ----

/** Reachability of the embedded mobile-bridge server, pushed to the renderer. */
export interface BridgeStatus {
  /** the local HTTP server is bound and listening */
  listening: boolean
  /** local port the HTTP server is bound to (127.0.0.1) */
  port: number | null
  /** number of connected phone clients */
  clients: number
  /**
   * Best-effort public HTTPS origin to reach the bridge from a phone, derived
   * from `tailscale status` (MagicDNS name). null when Tailscale isn't running
   * or serve isn't configured.
   */
  tailscaleOrigin: string | null
}

/** Pairing material shown on the desktop so a phone can pair once. */
export interface BridgePairing {
  /** short human-typeable code (e.g. 6 digits) */
  code: string
  /** the long bearer token a paired phone stores and sends thereafter */
  token: string
  /** fully-formed URL (origin + token) encoded into the desktop QR image */
  pairUrl: string | null
}

/**
 * Messages the bridge server pushes to a connected phone client over the
 * WebSocket. Mirrors the desktop's renderer data flow.
 */
export type BridgeServerMessage =
  | { type: 'hello'; state: AppState }
  | { type: 'attached'; id: TerminalId; snapshot: string }
  | { type: 'data'; id: TerminalId; data: string }
  | { type: 'title'; id: TerminalId; title: string | null }
  | { type: 'exit'; id: TerminalId; exitCode: number; signal?: number }
  | { type: 'state'; state: AppState }
  | { type: 'error'; message: string }

/** Messages a phone client sends up to the bridge server over the WebSocket. */
export type BridgeClientMessage =
  | { type: 'attach'; id: TerminalId }
  | { type: 'detach'; id: TerminalId }
  | { type: 'input'; id: TerminalId; data: string }
  | { type: 'resize'; id: TerminalId; cols: number; rows: number }
  | { type: 'create'; opts: CreateTerminalOptions }
  | { type: 'kill'; projectId: ProjectId; id: TerminalId }
  | { type: 'rename'; projectId: ProjectId; id: TerminalId; name: string }
  | { type: 'setActive'; projectId: ProjectId; id: TerminalId | null }
  | { type: 'selectProject'; projectId: ProjectId | null }
  | { type: 'subscribePush'; subscription: unknown }

export interface FocusTerminalPayload {
  projectId: ProjectId
  terminalId: TerminalId
}

// ---- Auto-update ----

/**
 * Lifecycle of the auto-updater, pushed from main to renderer on every
 * transition. `unsupported` is reported in dev / unpackaged builds where no
 * update feed exists. `version` is the *available* version (not the running one).
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; version: string }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

// ---- File system ----

export interface FsEntry {
  name: string
  /** path relative to the project root, using forward slashes; empty string = root */
  path: string
  isDirectory: boolean
  /** true if the path is ignored by git (matches a .gitignore rule, or sits under an ignored dir) */
  ignored?: boolean
}

// ---- Local git ----

/** A git repository discovered inside a project folder. */
export interface RepoRef {
  /** path relative to the project root, forward slashes; '' = the project root itself */
  rel: string
  /** display name (folder name; project folder name for the root repo) */
  name: string
}

export interface GitInfo {
  isRepo: boolean
  branch: string | null
  /** "owner/repo" if remote origin points at github.com, otherwise null */
  githubRepo: { owner: string; repo: string } | null
  /** branch has an upstream */
  hasUpstream: boolean
  ahead: number
  behind: number
  dirty: boolean
  /** the configured default branch on origin (HEAD), or null */
  defaultBranch: string | null
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflict'
export type GitFileStatusMap = Record<string, GitFileStatus>

// ---- GitHub ----

export interface GitHubSettings {
  /** OAuth App client id used for device flow; null = device flow disabled */
  clientId: string | null
  /** true when a credential is stored (PAT or device-flow token) */
  hasToken: boolean
  /** authenticated user login (or null if not authenticated / unknown) */
  login: string | null
  /** how the token was obtained */
  source: 'pat' | 'device' | null
}

export interface DeviceFlowStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** URL with user code pre-filled (`?user_code=...`). Opened in browser automatically. */
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export type DeviceFlowPoll =
  | { status: 'pending' }
  | { status: 'slow-down'; interval: number }
  | { status: 'authorized'; login: string }
  | { status: 'error'; error: string; description?: string }

export interface PullRequestSummary {
  number: number
  title: string
  state: 'open' | 'closed'
  draft: boolean
  merged: boolean
  url: string
  author: string
  authorAvatar: string | null
  headRef: string
  baseRef: string
  createdAt: string
  updatedAt: string
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string
  mergeable: boolean | null
  mergeableState: string | null
  additions: number
  deletions: number
  changedFiles: number
  comments: Array<{
    id: number
    author: string
    avatar: string | null
    body: string
    createdAt: string
  }>
  checks: Array<{
    name: string
    status: string
    conclusion: string | null
    url: string | null
  }>
}

export interface CreatePullRequestInput {
  projectId: ProjectId
  title: string
  body: string
  head: string
  base: string
  draft: boolean
  /** repo within the project ('' or omitted = project root) */
  repoRel?: string
}

export interface WorkflowSummary {
  id: number
  name: string
  path: string
  state: string
}

export interface WorkflowRunSummary {
  id: number
  name: string | null
  workflowId: number
  branch: string | null
  event: string
  status: string
  conclusion: string | null
  url: string
  runNumber: number
  actor: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  url: string
  steps: Array<{ name: string; status: string; conclusion: string | null; number: number }>
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  jobs: WorkflowJob[]
}
