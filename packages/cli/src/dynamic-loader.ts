/**
 * Dynamic command registration from manifest JSON.
 * Converts manifest definitions → Commander.js commands at runtime.
 */
import { Command, Option } from 'commander'
import { readFileSync } from 'node:fs'
import { resolveSpaceId } from './config.js'
import { buildParams, buildStdinParams, camelCase, extractLongFlag } from './input.js'
import { callTool } from './api-client.js'
import { output, outputError } from './output.js'
import { uploadFile, defaultUploadDeps } from './upload.js'
import { sanitize } from './manifest-validator.js'
import type {
  Manifest,
  ManifestCommand,
  ManifestSubcommand,
  ManifestOption,
} from './manifest-validator.js'
import chalk from 'chalk'

/**
 * Resolve a constraint key to a Commander opts key.
 * Handles negatable flags: "no-dry-run" → Commander stores as "dryRun" (boolean false).
 */
function resolveConstraintKey(
  flagRef: string,
  optionDefs: ManifestOption[],
): { key: string; isNegatable: boolean } {
  // Check if flagRef references a negatable option (--no-xxx)
  if (flagRef.startsWith('no-')) {
    const positiveFlag = flagRef.slice(3) // "no-dry-run" → "dry-run"
    const positiveKey = camelCase(positiveFlag) // "dry-run" → "dryRun"
    // Check if the option is actually negatable
    const matchingOpt = optionDefs.find(
      (o) => o.type === 'negatable' && extractLongFlag(o.flags) === `no-${positiveFlag}`,
    )
    if (matchingOpt) {
      return { key: positiveKey, isNegatable: true }
    }
  }
  return { key: camelCase(flagRef), isNegatable: false }
}

/**
 * Validate dependsOn / conflictsWith constraints.
 * Returns error message or null if valid.
 */
function validateConstraints(
  optionDefs: ManifestOption[],
  opts: Record<string, unknown>,
): string | null {
  for (const def of optionDefs) {
    const selfKey = camelCase(extractLongFlag(def.flags))
    if (opts[selfKey] === undefined) continue

    // dependsOn: requires another option
    if (def.dependsOn) {
      const { key: depKey, isNegatable } = resolveConstraintKey(def.dependsOn, optionDefs)
      // For negatable: "dryRun" will be false when --no-dry-run is passed
      const depPresent = isNegatable
        ? opts[depKey] === false // --no-xxx explicitly passed
        : opts[depKey] !== undefined
      if (!depPresent) {
        return `--${extractLongFlag(def.flags)} requires --${def.dependsOn}`
      }
    }

    // conflictsWith: mutually exclusive
    if (def.conflictsWith) {
      const { key: conflictKey, isNegatable } = resolveConstraintKey(def.conflictsWith, optionDefs)
      const conflictPresent = isNegatable
        ? opts[conflictKey] === false
        : opts[conflictKey] !== undefined
      if (conflictPresent) {
        return `--${extractLongFlag(def.flags)} conflicts with --${def.conflictsWith}`
      }
    }
  }

  return null
}

/**
 * Read all of stdin as UTF-8 text. JSON/text の解釈は input.ts の buildStdinParams に任せる。
 */
async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/** stdin テキスト系コマンド(stdinFormat='text')にだけ CLI 側で足す入力元オプション */
const FILE_OPTION_FLAGS = '--file <path>'

/**
 * Create an action handler for a subcommand.
 */
function createAction(
  sub: ManifestSubcommand,
  program: Command,
): (opts: Record<string, unknown>) => Promise<void> {
  return async (opts: Record<string, unknown>) => {
    const jsonMode = program.opts().json

    // Deprecation warning
    if (sub.deprecated) {
      console.error(chalk.yellow(`Warning: "${sub.name}" is deprecated`))
    }

    // Constraint validation
    const error = validateConstraints(sub.options, opts)
    if (error) {
      outputError(new Error(error), jsonMode)
      return
    }

    try {
      // upload mode: ローカルファイルを 署名URL発行 → PUT → 完了確定 の3段階で送る(file upload)
      if (sub.uploadMode) {
        const filePath = typeof opts.file === 'string' ? opts.file : undefined
        if (!filePath) {
          console.error(`Error: ${sub.name} requires --file <path>.`)
          console.error(`Example: agentpm file ${sub.name} --file ./list.csv`)
          process.exit(1)
        }
        const spaceId = resolveSpaceId(opts as { spaceId?: string })
        const result = await uploadFile(
          {
            filePath,
            spaceId,
            name: typeof opts.name === 'string' ? opts.name : undefined,
            mimeType: typeof opts.mimeType === 'string' ? opts.mimeType : undefined,
            tool: sub.tool,
            completeTool: sub.completeTool ?? 'file_upload_complete',
          },
          { ...defaultUploadDeps, callTool },
        )
        output(result, jsonMode)
        return
      }

      // stdin mode: JSON(scheduling create/respond) or raw text(task import via --stdin / --file)
      const isTextMode = sub.stdinFormat === 'text'
      const filePath = isTextMode && typeof opts.file === 'string' ? opts.file : undefined
      if (sub.stdinMode && (opts.stdin || filePath)) {
        const rawText = filePath ? readFileSync(filePath, 'utf-8') : await readStdinText()
        // spaceId は CLI 側(resolve 済み)を優先。stdin 側に無いコマンドもあるので失敗は握る
        let resolvedSpaceId: string | undefined
        if (sub.options.some((o) => o.resolve === 'spaceId')) {
          try {
            resolvedSpaceId = resolveSpaceId(opts as { spaceId?: string })
          } catch {
            // spaceId not required for all commands
          }
        }
        const stdinParams = buildStdinParams(sub, rawText, opts, resolvedSpaceId)
        const result = await callTool(sub.tool, stdinParams)
        output(result, jsonMode)
        return
      }

      // stdin required but not provided
      if (sub.stdinMode) {
        if (isTextMode) {
          console.error(`Error: ${sub.name} requires --file <path> or --stdin.`)
          console.error(`Example: agentpm ... ${sub.name} --file tasks.csv`)
          console.error(`         cat tasks.csv | agentpm ... ${sub.name} --stdin`)
        } else {
          console.error(`Error: ${sub.name} requires --stdin with JSON input.`)
          console.error(`Example: echo '{"key":"value"}' | agentpm ... --stdin`)
        }
        process.exit(1)
      }

      // Normal mode
      let resolvedSpaceId: string | undefined
      if (sub.options.some((o) => o.resolve === 'spaceId')) {
        // -s 省略時も defaultSpaceId / TASKAPP_SPACE_ID を使う。無ければ resolveSpaceId が案内を出して終了する
        resolvedSpaceId = resolveSpaceId(opts as { spaceId?: string })
      }
      const params = buildParams(sub.options, opts, resolvedSpaceId)
      const result = await callTool(sub.tool, params)
      output(result, jsonMode)
    } catch (e) {
      outputError(e, jsonMode)
    }
  }
}

/**
 * Register a single option on a Commander command.
 */
function registerOption(cmd: Command, opt: ManifestOption): void {
  const desc = sanitize(opt.description || '')
  const option = new Option(opt.flags, desc)
  if (opt.required) option.makeOptionMandatory(true)
  if (opt.default !== undefined) option.default(opt.default)
  if (opt.choices) option.choices(opt.choices)
  cmd.addOption(option)
}

/**
 * Register a subcommand on a parent command group.
 */
function registerSubcommand(
  parent: Command,
  sub: ManifestSubcommand,
  program: Command,
): void {
  const subCmd = parent.command(sub.name).description(sanitize(sub.description))

  if (sub.aliases) {
    for (const alias of sub.aliases) subCmd.alias(alias)
  }
  if (sub.hidden) (subCmd as Command & { hideHelp: (h?: boolean) => Command }).hideHelp()
  if (sub.examples?.length) {
    subCmd.addHelpText(
      'after',
      '\nExamples:\n' + sub.examples.map((e) => `  $ ${sanitize(e)}`).join('\n'),
    )
  }

  for (const opt of sub.options) {
    registerOption(subCmd, opt)
  }
  // stdinFormat='text' のコマンドには、manifest に無くても CLI 側で --file を足す。
  // manifest に載せると旧CLI(0.2.x)の検証が type を知らず manifest 全体を弾いてしまうため、
  // 旧CLIに影響しないここ(クライアント側)で付ける。
  if (sub.stdinFormat === 'text') {
    subCmd.addOption(new Option(FILE_OPTION_FLAGS, 'Read input from a file instead of stdin'))
  }

  subCmd.action(createAction(sub, program))
}

/**
 * Register all commands from a manifest onto the program.
 */
export function registerDynamicCommands(
  program: Command,
  manifest: Manifest,
): void {
  for (const cmd of manifest.commands) {
    // Top-level command with direct tool (e.g., dashboard)
    if (cmd.tool && !cmd.subcommands) {
      const topCmd = program.command(cmd.name).description(sanitize(cmd.description))
      if (cmd.aliases) {
        for (const alias of cmd.aliases) topCmd.alias(alias)
      }
      if (cmd.options) {
        for (const opt of cmd.options) {
          registerOption(topCmd, opt)
        }
      }
      // Create a pseudo-subcommand definition for the action handler
      const pseudoSub: ManifestSubcommand = {
        name: cmd.name,
        description: cmd.description,
        tool: cmd.tool,
        options: cmd.options || [],
      }
      topCmd.action(createAction(pseudoSub, program))
      continue
    }

    // Command group with subcommands
    if (cmd.subcommands) {
      const group = program.command(cmd.name).description(sanitize(cmd.description))
      if (cmd.aliases) {
        for (const alias of cmd.aliases) group.alias(alias)
      }
      for (const sub of cmd.subcommands) {
        registerSubcommand(group, sub, program)
      }
    }
  }
}
