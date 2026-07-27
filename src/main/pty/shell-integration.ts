import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

// FinalTerm OSC 133 prompt markers emitted from precmd/preexec hooks.
// The renderer uses the C..D span to drive the "terminal is working" indicator.
//
// Note on escaping: in these template literals, `\\e` and `\\a` become the
// two-character sequences `\e` and `\a` in the file we write — the shell
// then interprets those as the real escape/bell characters at runtime.
// Every `\${` escapes a JS interpolation so the literal `${...}` ends up
// in the shell script.

const ZSH_INTEGRATION = `
# wTerm shell integration (OSC 133 working markers + OSC 697 agent capture).
# OSC 697;Cmd reports the command line + cwd (base64) so wTerm can re-run a
# running agent (claude, aider, ...) after a restart. base64 keeps arbitrary
# command text safe inside the escape sequence. \$3 is the alias-EXPANDED full
# command (an alias like cc='claude ...' must be captured expanded so restore
# rules can match the real program); \$2 looks similar but silently TRUNCATES
# long commands (dropping e.g. a --resume uuid), so it must not be used.
# \$1 (as typed) is the fallback, and 1024 chars is plenty for a launch command.
__tw_preexec() {
  print -Pn '\\e]133;C\\a'
  printf '\\e]697;Cmd;%s;%s\\a' "\$(print -rn -- "\${\${3:-\$1}[1,1024]}" | base64 | tr -d '\\n')" "\$(print -rn -- "\$PWD" | base64 | tr -d '\\n')"
}
__tw_precmd()  { print -Pn "\\e]133;D;\${?}\\a" }
autoload -Uz add-zsh-hook 2>/dev/null
if typeset -f add-zsh-hook >/dev/null; then
  add-zsh-hook preexec __tw_preexec
  add-zsh-hook precmd  __tw_precmd
fi
`

const BASH_INTEGRATION = `
# wTerm shell integration (OSC 133).
__tw_preexec() {
  [[ -n "\$COMP_LINE" ]] && return
  [[ "\$BASH_COMMAND" == "\$PROMPT_COMMAND" ]] && return
  printf '\\e]133;C\\a'
  printf '\\e]697;Cmd;%s;%s\\a' "\$(printf '%s' "\$BASH_COMMAND" | base64 | tr -d '\\n')" "\$(printf '%s' "\$PWD" | base64 | tr -d '\\n')"
}
__tw_precmd() {
  local ec=\$?
  printf '\\e]133;D;%s\\a' "\$ec"
}
trap '__tw_preexec' DEBUG
case "\$PROMPT_COMMAND" in
  *__tw_precmd*) ;;
  *) PROMPT_COMMAND="__tw_precmd\${PROMPT_COMMAND:+;\$PROMPT_COMMAND}" ;;
esac
`

const FISH_INTEGRATION = `
# wTerm shell integration (OSC 133).
function __tw_preexec --on-event fish_preexec
    printf '\\e]133;C\\a'
    printf '\\e]697;Cmd;%s;%s\\a' (string join ' ' -- \$argv | base64 | tr -d '\\n') (printf '%s' "\$PWD" | base64 | tr -d '\\n')
end
function __tw_postexec --on-event fish_postexec
    printf '\\e]133;D;%s\\a' \$status
end
`

type ShellKind = 'zsh' | 'bash' | 'fish' | 'unknown'

function detectShell(shellPath: string): ShellKind {
  const name = basename(shellPath).toLowerCase()
  if (name.includes('zsh')) return 'zsh'
  if (name.includes('bash')) return 'bash'
  if (name.includes('fish')) return 'fish'
  return 'unknown'
}

/**
 * The shell to launch when the caller doesn't specify one. On POSIX we honor
 * $SHELL (the user's login shell) and fall back to zsh. On Windows there is no
 * $SHELL convention — defaulting to it would try to spawn `/bin/zsh`, which
 * doesn't exist — so we use PowerShell, which ships on every supported Windows
 * version and is the better interactive experience than cmd.exe. node-pty
 * resolves the bare name via PATH (System32 is always present there).
 */
export function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.WTERM_SHELL || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

interface PreparedSpawn {
  args: string[]
  env: Record<string, string>
}

let cachedZshDir: string | null = null
let cachedBashRc: string | null = null
let cachedFishConf: string | null = null

// The wrapper files live in $TMPDIR, and macOS periodic maintenance deletes
// tmp files it considers stale (~3 days) even while the app is still running.
// A path cached at first spawn can therefore go dark later, and every new
// shell would boot with an empty ZDOTDIR/rcfile — no user aliases, no
// integration. So the cache is only a location hint: every spawn re-checks
// the files on disk and rewrites any that are missing.
function ensureFile(path: string, content: string): void {
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, content, { mode: 0o600 })
}

// zsh: override ZDOTDIR with a wrapper directory whose .zshenv/.zshrc source
// the user's real ones (from _TW_USER_ZDOTDIR) and then layer our hooks on top.
function prepareZshDir(): string {
  const dir = cachedZshDir ?? mkdtempSync(join(tmpdir(), 'tw-zsh-'))

  // .zshenv runs first; preserve user's zshenv but keep ZDOTDIR pointing at
  // our wrapper so the wrapper .zshrc still loads next.
  const zshenv = `# wTerm wrapper .zshenv
if [ -n "\$_TW_USER_ZDOTDIR" ]; then
  __tw_our_zdotdir="\$ZDOTDIR"
  ZDOTDIR="\$_TW_USER_ZDOTDIR"
  [ -f "\$ZDOTDIR/.zshenv" ] && . "\$ZDOTDIR/.zshenv"
  ZDOTDIR="\$__tw_our_zdotdir"
  unset __tw_our_zdotdir
fi
`

  // .zshrc sources the user's real .zshrc, then our integration, then hands
  // ZDOTDIR back to the user — anything they (or their plugins) read from it
  // later sees the value they expect.
  const zshrc = `# wTerm wrapper .zshrc
if [ -n "\$_TW_USER_ZDOTDIR" ]; then
  ZDOTDIR="\$_TW_USER_ZDOTDIR"
  [ -f "\$ZDOTDIR/.zshrc" ] && . "\$ZDOTDIR/.zshrc"
fi
${ZSH_INTEGRATION}
unset _TW_USER_ZDOTDIR
`

  ensureFile(join(dir, '.zshenv'), zshenv)
  ensureFile(join(dir, '.zshrc'), zshrc)
  cachedZshDir = dir
  return dir
}

function prepareBashRc(): string {
  const dir = cachedBashRc ? dirname(cachedBashRc) : mkdtempSync(join(tmpdir(), 'tw-bash-'))
  const rc = `# wTerm wrapper bashrc
[ -f "\$HOME/.bashrc" ] && . "\$HOME/.bashrc"
${BASH_INTEGRATION}
`
  const path = join(dir, 'bashrc')
  ensureFile(path, rc)
  cachedBashRc = path
  return path
}

function prepareFishConf(): string {
  const dir = cachedFishConf ? dirname(cachedFishConf) : mkdtempSync(join(tmpdir(), 'tw-fish-'))
  const path = join(dir, 'integration.fish')
  ensureFile(path, FISH_INTEGRATION)
  cachedFishConf = path
  return path
}

export function prepareShellIntegration(
  shellPath: string,
  baseEnv: Record<string, string>
): PreparedSpawn {
  const kind = detectShell(shellPath)
  switch (kind) {
    case 'zsh': {
      const dir = prepareZshDir()
      const userZdotdir = baseEnv.ZDOTDIR ?? baseEnv.HOME ?? ''
      return {
        args: [],
        env: { ...baseEnv, ZDOTDIR: dir, _TW_USER_ZDOTDIR: userZdotdir },
      }
    }
    case 'bash': {
      const rc = prepareBashRc()
      return { args: ['--rcfile', rc], env: baseEnv }
    }
    case 'fish': {
      const conf = prepareFishConf()
      return { args: ['--init-command', `source ${conf}`], env: baseEnv }
    }
    default:
      return { args: [], env: baseEnv }
  }
}
